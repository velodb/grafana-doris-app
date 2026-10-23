package plugin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestResolveKeyrockProvider(t *testing.T) {
	provider, err := resolveKeyrockProvider(Settings{KeyrockBaseURL: "https://keyrock.example/", KeyrockClientID: "grafana local"})
	if err != nil {
		t.Fatal(err)
	}
	if provider.Issuer != "https://keyrock.example/idm/applications/grafana%20local" || provider.JWKSURL != provider.Issuer+"/certs" || provider.Audience != "grafana local" {
		t.Fatalf("unexpected Keyrock provider: %#v", provider)
	}
}

func TestResolveDiscoveryCachesDocument(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/.well-known/openid-configuration" {
			t.Fatalf("unexpected discovery path %s", r.URL.Path)
		}
		w.Header().Set("Cache-Control", "max-age=60")
		_, _ = w.Write([]byte(`{"issuer":"` + serverURL(r) + `","jwks_uri":"` + serverURL(r) + `/keys"}`))
	}))
	defer server.Close()
	resolver := newProviderResolver(server.Client())
	settings := Settings{ProviderMode: providerModeOIDCDiscovery, OIDCIssuer: server.URL, OIDCAudience: "grafana", AllowInsecureIDP: true}
	for range 2 {
		provider, err := resolver.resolve(context.Background(), settings)
		if err != nil || provider.JWKSURL != server.URL+"/keys" {
			t.Fatalf("resolve discovery: provider=%#v err=%v", provider, err)
		}
	}
	if requests.Load() != 1 {
		t.Fatalf("expected cached discovery document, got %d requests", requests.Load())
	}
}

func TestResolveDiscoveryRejectsMismatchAndHTTPByDefault(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"issuer":"https://other.example","jwks_uri":"https://other.example/keys"}`))
	}))
	defer server.Close()
	resolver := newProviderResolver(server.Client())
	_, err := resolver.resolve(context.Background(), Settings{ProviderMode: providerModeOIDCDiscovery, OIDCIssuer: server.URL, OIDCAudience: "grafana"})
	if err == nil || !strings.Contains(err.Error(), "HTTPS") {
		t.Fatalf("expected HTTP rejection, got %v", err)
	}
	_, err = resolver.resolve(context.Background(), Settings{ProviderMode: providerModeOIDCDiscovery, OIDCIssuer: server.URL, OIDCAudience: "grafana", AllowInsecureIDP: true})
	if err == nil || !strings.Contains(err.Error(), "does not exactly match") {
		t.Fatalf("expected issuer mismatch, got %v", err)
	}
}

func TestResolveDiscoveryRejectsMalformedAndMissingJWKSURL(t *testing.T) {
	for name, body := range map[string]string{
		"malformed document": "{",
		"missing jwks uri":   `{"issuer":"http://placeholder"}`,
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if name == "missing jwks uri" {
					body = `{"issuer":"` + serverURL(r) + `"}`
				}
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()
			_, err := newProviderResolver(server.Client()).resolve(context.Background(), Settings{
				ProviderMode: providerModeOIDCDiscovery, OIDCIssuer: server.URL, OIDCAudience: "grafana", AllowInsecureIDP: true,
			})
			if err == nil {
				t.Fatal("expected discovery rejection")
			}
		})
	}
}

func TestResolveDiscoveryRewritesBackchannelJWKSURL(t *testing.T) {
	const issuer = "https://idp.example/realms/velodb"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/proxy/realms/velodb/.well-known/openid-configuration" {
			t.Fatalf("unexpected backchannel discovery path %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"issuer":"` + issuer + `","jwks_uri":"` + issuer + `/keys"}`))
	}))
	defer server.Close()

	provider, err := newProviderResolver(server.Client()).resolve(context.Background(), Settings{
		ProviderMode:       providerModeOIDCDiscovery,
		OIDCIssuer:         issuer,
		OIDCAudience:       "grafana",
		OIDCBackchannelURL: server.URL + "/proxy",
		AllowInsecureIDP:   true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if provider.JWKSURL != server.URL+"/proxy/realms/velodb/keys" {
		t.Fatalf("unexpected rewritten JWKS URL %q", provider.JWKSURL)
	}
}

func TestResolveLegacyKeyrockSettings(t *testing.T) {
	resolver := newProviderResolver(http.DefaultClient)
	provider, err := resolver.resolve(context.Background(), Settings{KeyrockIssuer: "https://legacy.example/issuer", KeyrockJWKSURL: "https://legacy.example/certs", KeyrockAudience: "legacy-client"})
	if err != nil || provider.Mode != "keyrockLegacy" {
		t.Fatalf("legacy provider=%#v err=%v", provider, err)
	}
}

func TestCacheDuration(t *testing.T) {
	if got := cacheDuration("max-age=999999"); got != providerCacheMaxAge {
		t.Fatalf("expected cap %s, got %s", providerCacheMaxAge, got)
	}
	if got := cacheDuration(""); got != 5*time.Minute {
		t.Fatalf("expected default cache duration, got %s", got)
	}
}

func serverURL(r *http.Request) string { return "http://" + r.Host }
