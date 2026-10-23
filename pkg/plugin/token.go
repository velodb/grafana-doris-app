package plugin

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const dorisTokenLifetime = 5 * time.Minute

type oidcClaims struct {
	jwt.RegisteredClaims
	Groups any `json:"groups"`
}

type verifiedIdentity struct {
	Subject      string
	Groups       []string
	ProviderMode string
}

type jwkSet struct {
	Keys []jwk `json:"keys"`
}
type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type tokenExchanger struct {
	httpClient *http.Client
	providers  *providerResolver
	jwks       *jwksCache
}

type cachedJWKS struct {
	set     jwkSet
	expires time.Time
}

type jwksCache struct {
	mu      sync.Mutex
	entries map[string]cachedJWKS
}

func newJWKSCache() *jwksCache { return &jwksCache{entries: make(map[string]cachedJWKS)} }

func (e tokenExchanger) verifyKeyrockIDToken(ctx context.Context, raw string, settings Settings) (verifiedIdentity, error) {
	if raw == "" {
		return verifiedIdentity{}, fmt.Errorf("OIDC ID token is required; enable Forward OAuth Identity for this datasource")
	}
	resolver := e.providers
	if resolver == nil {
		resolver = newProviderResolver(e.httpClient)
	}
	provider, err := resolver.resolve(ctx, settings)
	if err != nil {
		return verifiedIdentity{}, err
	}
	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}), jwt.WithIssuer(provider.Issuer), jwt.WithAudience(provider.Audience))
	claims := &oidcClaims{}
	_, err = parser.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		kid, _ := token.Header["kid"].(string)
		key, err := e.fetchKey(ctx, provider.JWKSURL, kid)
		if err != nil {
			return nil, err
		}
		return key, nil
	})
	if err != nil {
		return verifiedIdentity{}, fmt.Errorf("OIDC ID token validation failed: %w", err)
	}
	if claims.Subject == "" {
		return verifiedIdentity{}, fmt.Errorf("OIDC ID token has no sub claim")
	}
	groups, err := stringGroups(claims.Groups)
	if err != nil {
		return verifiedIdentity{}, err
	}
	return verifiedIdentity{Subject: claims.Subject, Groups: groups, ProviderMode: provider.Mode}, nil
}

func stringGroups(value any) ([]string, error) {
	if value == nil {
		return nil, nil
	}
	if group, ok := value.(string); ok {
		return []string{group}, nil
	}
	values, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("OIDC ID token groups claim must be a string or string array")
	}
	groups := make([]string, 0, len(values))
	for _, value := range values {
		group, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("OIDC ID token groups claim must contain only strings")
		}
		groups = append(groups, group)
	}
	return groups, nil
}

func (e tokenExchanger) fetchKey(ctx context.Context, url, kid string) (*rsa.PublicKey, error) {
	if url == "" {
		return nil, fmt.Errorf("Keyrock JWKS URL is required")
	}
	cache := e.jwks
	if cache == nil {
		cache = newJWKSCache()
	}
	keys, err := cache.get(ctx, e.httpClient, url, false)
	if err != nil {
		return nil, err
	}
	matching := matchingRSAKeys(keys, kid)
	// A new kid is the normal signal for key rotation. Refresh once instead
	// of waiting for Cache-Control expiry, while still never accepting a key
	// that is absent from the current JWKS document.
	if len(matching) == 0 && kid != "" {
		keys, err = cache.get(ctx, e.httpClient, url, true)
		if err != nil {
			return nil, err
		}
		matching = matchingRSAKeys(keys, kid)
	}
	if len(matching) == 1 {
		return rsaKey(matching[0])
	}
	if kid == "" {
		return nil, fmt.Errorf("Keyrock ID token has no kid and JWKS does not contain exactly one RS256 key")
	}
	return nil, fmt.Errorf("Keyrock JWKS does not contain RS256 key %q", kid)
}

func matchingRSAKeys(keys jwkSet, kid string) []jwk {
	var matching []jwk
	for _, key := range keys.Keys {
		if key.Kty == "RSA" && key.Alg == "RS256" && (kid == "" || key.Kid == kid) {
			matching = append(matching, key)
		}
	}
	return matching
}

func (c *jwksCache) get(ctx context.Context, client *http.Client, url string, refresh bool) (jwkSet, error) {
	c.mu.Lock()
	entry, ok := c.entries[url]
	c.mu.Unlock()
	if !refresh && ok && time.Now().Before(entry.expires) {
		return entry.set, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return jwkSet{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return jwkSet{}, fmt.Errorf("fetch OIDC JWKS: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return jwkSet{}, fmt.Errorf("fetch OIDC JWKS: unexpected status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return jwkSet{}, err
	}
	var keys jwkSet
	if err := json.Unmarshal(body, &keys); err != nil {
		return jwkSet{}, fmt.Errorf("decode OIDC JWKS: %w", err)
	}
	c.mu.Lock()
	c.entries[url] = cachedJWKS{set: keys, expires: time.Now().Add(cacheDuration(resp.Header.Get("Cache-Control")))}
	c.mu.Unlock()
	return keys, nil
}

func rsaKey(key jwk) (*rsa.PublicKey, error) {
	n, err := base64.RawURLEncoding.DecodeString(key.N)
	if err != nil {
		return nil, err
	}
	e, err := base64.RawURLEncoding.DecodeString(key.E)
	if err != nil {
		return nil, err
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}, nil
}

func (e tokenExchanger) issueDorisToken(subject string, dorisGroups []string, issuer, audience, keyID string, key *rsa.PrivateKey) (string, error) {
	if issuer == "" || audience == "" {
		return "", fmt.Errorf("Doris token issuer and audience are required")
	}
	identifier := make([]byte, 16)
	if _, err := rand.Read(identifier); err != nil {
		return "", err
	}
	now := time.Now()
	claims := jwt.MapClaims{
		"iss": issuer, "aud": audience, "sub": subject, "username": subject,
		"client_id": "velodb-doris-datasource", "scope": "doris.query",
		// Doris 4.1's OIDC authentication plugin reads the standard claim even
		// when oidc.groups_claim is configured. Keep the explicit claim for
		// newer deployments and emit the standard alias for compatibility.
		"doris_groups": dorisGroups, "groups": dorisGroups,
		"iat": now.Unix(), "nbf": now.Unix(), "exp": now.Add(dorisTokenLifetime).Unix(), "jti": base64.RawURLEncoding.EncodeToString(identifier),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = keyID
	return token.SignedString(key)
}

func idTokenFromHeader(header string) string {
	if header == "" {
		return ""
	}
	return strings.TrimSpace(header)
}
