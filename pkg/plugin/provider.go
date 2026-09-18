package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	providerModeOIDCDiscovery = "oidcDiscovery"
	providerModeKeyrock       = "keyrock"
	providerCacheMaxAge       = time.Hour
)

type identityProvider struct {
	Mode     string
	Issuer   string
	JWKSURL  string
	Audience string
}

type discoveryDocument struct {
	Issuer  string `json:"issuer"`
	JWKSURL string `json:"jwks_uri"`
}

type providerCacheEntry struct {
	provider identityProvider
	expires  time.Time
}

type providerResolver struct {
	httpClient *http.Client
	mu         sync.Mutex
	cache      map[string]providerCacheEntry
}

func newProviderResolver(client *http.Client) *providerResolver {
	return &providerResolver{httpClient: client, cache: make(map[string]providerCacheEntry)}
}

func (r *providerResolver) resolve(ctx context.Context, settings Settings) (identityProvider, error) {
	mode := settings.ProviderMode
	if mode == "" && settings.KeyrockIssuer != "" && settings.KeyrockJWKSURL != "" && settings.KeyrockAudience != "" {
		return identityProvider{Mode: "keyrockLegacy", Issuer: settings.KeyrockIssuer, JWKSURL: settings.KeyrockJWKSURL, Audience: settings.KeyrockAudience}, nil
	}
	switch mode {
	case providerModeKeyrock:
		return resolveKeyrockProvider(settings)
	case providerModeOIDCDiscovery:
		return r.resolveDiscovery(ctx, settings)
	default:
		return identityProvider{}, fmt.Errorf("identity provider mode must be oidcDiscovery or keyrock")
	}
}

func resolveKeyrockProvider(settings Settings) (identityProvider, error) {
	base, err := normalizeEndpoint(settings.KeyrockBaseURL, settings.AllowInsecureIDP)
	if err != nil {
		return identityProvider{}, fmt.Errorf("invalid Keyrock base URL: %w", err)
	}
	if settings.KeyrockClientID == "" {
		return identityProvider{}, fmt.Errorf("Keyrock Application Client ID is required")
	}
	clientID := url.PathEscape(settings.KeyrockClientID)
	issuer := base + "/idm/applications/" + clientID
	return identityProvider{Mode: providerModeKeyrock, Issuer: issuer, JWKSURL: issuer + "/certs", Audience: settings.KeyrockClientID}, nil
}

func (r *providerResolver) resolveDiscovery(ctx context.Context, settings Settings) (identityProvider, error) {
	issuer, err := normalizeEndpoint(settings.OIDCIssuer, settings.AllowInsecureIDP)
	if err != nil {
		return identityProvider{}, fmt.Errorf("invalid OIDC issuer: %w", err)
	}
	if settings.OIDCAudience == "" {
		return identityProvider{}, fmt.Errorf("OIDC audience / Grafana OAuth Client ID is required")
	}
	backchannel := ""
	if settings.OIDCBackchannelURL != "" {
		backchannel, err = normalizeEndpoint(settings.OIDCBackchannelURL, settings.AllowInsecureIDP)
		if err != nil {
			return identityProvider{}, fmt.Errorf("invalid OIDC backchannel base URL: %w", err)
		}
	}
	cacheKey := issuer + "\x00" + settings.OIDCAudience + "\x00" + backchannel + "\x00" + strconv.FormatBool(settings.AllowInsecureIDP)
	r.mu.Lock()
	entry, ok := r.cache[cacheKey]
	r.mu.Unlock()
	if ok && time.Now().Before(entry.expires) {
		return entry.provider, nil
	}

	discoveryIssuer := issuer
	if backchannel != "" {
		discoveryIssuer, err = replaceEndpointOrigin(issuer, backchannel)
		if err != nil {
			return identityProvider{}, err
		}
	}
	discoveryURL := discoveryIssuer + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discoveryURL, nil)
	if err != nil {
		return identityProvider{}, err
	}
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return identityProvider{}, fmt.Errorf("fetch OIDC discovery document: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return identityProvider{}, fmt.Errorf("fetch OIDC discovery document: unexpected status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return identityProvider{}, err
	}
	var document discoveryDocument
	if err := json.Unmarshal(body, &document); err != nil {
		return identityProvider{}, fmt.Errorf("decode OIDC discovery document: %w", err)
	}
	returnedIssuer, err := normalizeEndpoint(document.Issuer, settings.AllowInsecureIDP)
	if err != nil || returnedIssuer != issuer {
		return identityProvider{}, fmt.Errorf("OIDC discovery issuer does not exactly match configured issuer")
	}
	jwksURL, err := normalizeEndpoint(document.JWKSURL, settings.AllowInsecureIDP)
	if err != nil {
		return identityProvider{}, fmt.Errorf("invalid OIDC discovery jwks_uri: %w", err)
	}
	if backchannel != "" {
		if rewritten, rewriteErr := replaceEndpointOriginForIssuer(jwksURL, issuer, backchannel); rewriteErr != nil {
			return identityProvider{}, rewriteErr
		} else {
			jwksURL = rewritten
		}
	}
	provider := identityProvider{Mode: providerModeOIDCDiscovery, Issuer: issuer, JWKSURL: jwksURL, Audience: settings.OIDCAudience}
	r.mu.Lock()
	r.cache[cacheKey] = providerCacheEntry{provider: provider, expires: time.Now().Add(cacheDuration(resp.Header.Get("Cache-Control")))}
	r.mu.Unlock()
	return provider, nil
}

func replaceEndpointOrigin(original, replacement string) (string, error) {
	originalURL, err := url.Parse(original)
	if err != nil {
		return "", err
	}
	replacementURL, err := url.Parse(replacement)
	if err != nil {
		return "", err
	}
	originalURL.Scheme, originalURL.Host = replacementURL.Scheme, replacementURL.Host
	originalURL.Path = strings.TrimRight(replacementURL.Path, "/") + originalURL.Path
	return strings.TrimRight(originalURL.String(), "/"), nil
}

func replaceEndpointOriginForIssuer(endpoint, issuer, backchannel string) (string, error) {
	endpointURL, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	issuerURL, err := url.Parse(issuer)
	if err != nil {
		return "", err
	}
	if endpointURL.Scheme != issuerURL.Scheme || endpointURL.Host != issuerURL.Host {
		return endpoint, nil
	}
	return replaceEndpointOrigin(endpoint, backchannel)
}

func normalizeEndpoint(value string, allowInsecure bool) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("must be an absolute URL without credentials, query, or fragment")
	}
	if parsed.Scheme != "https" && !(allowInsecure && parsed.Scheme == "http") {
		return "", fmt.Errorf("must use HTTPS (enable local insecure IDP mode only for HTTP testing)")
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func cacheDuration(cacheControl string) time.Duration {
	for _, directive := range strings.Split(cacheControl, ",") {
		parts := strings.SplitN(strings.TrimSpace(directive), "=", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "max-age") {
			if seconds, err := strconv.Atoi(parts[1]); err == nil && seconds > 0 {
				duration := time.Duration(seconds) * time.Second
				if duration > providerCacheMaxAge {
					return providerCacheMaxAge
				}
				return duration
			}
		}
	}
	return 5 * time.Minute
}
