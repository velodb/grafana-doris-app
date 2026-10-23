package plugin

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func idpContext(org int64, uid string) backend.PluginContext {
	return backend.PluginContext{OrgID: org, DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{UID: uid}}
}
func certificatePEM(cert *x509.Certificate) string {
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw}))
}
func unrelatedCA(t *testing.T) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(123), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	raw, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: raw}))
}

func TestIDPTLSDiscoveryAndJWKS(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var issuer string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(discoveryDocument{Issuer: issuer, JWKSURL: issuer + "/keys"})
		case "/keys":
			writeJWKS(w, &key.PublicKey, "kid")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	issuer = server.URL
	ca := certificatePEM(server.Certificate())
	wrongCA := unrelatedCA(t)
	for _, tc := range []struct {
		name             string
		skip             bool
		ca               string
		hostnameMismatch bool
		wantErr          bool
	}{
		{name: "default rejects self signed", wantErr: true},
		{name: "explicit skip", skip: true},
		{name: "custom CA", ca: ca},
		{name: "CA bundle", ca: ca + wrongCA},
		{name: "wrong CA", ca: wrongCA, wantErr: true},
		{name: "malformed CA", ca: "invalid", wantErr: true},
		{name: "malformed CA while skipping", skip: true, ca: "invalid", wantErr: true},
		{name: "partial malformed bundle", ca: ca + "invalid", wantErr: true},
		{name: "malformed first certificate", ca: "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----\n" + ca, wantErr: true},
		{name: "hostname mismatch", ca: ca, hostnameMismatch: true, wantErr: true},
		{name: "skip hostname mismatch", skip: true, hostnameMismatch: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			endpoint := server.URL
			if tc.hostnameMismatch {
				endpoint = strings.Replace(endpoint, "127.0.0.1", "localhost", 1)
			}
			settings := Settings{ProviderMode: providerModeOIDCDiscovery, OIDCIssuer: server.URL, OIDCAudience: "grafana", IDPTLSSkipVerify: tc.skip}
			if tc.hostnameMismatch {
				settings.OIDCBackchannelURL = endpoint
			}
			d := newDatasource(http.DefaultClient, nil, nil)
			ex, err := d.idpExchanger(idpContext(1, "a"), settings, Secrets{IDPTLSCACert: tc.ca})
			if err == nil {
				_, err = ex.providers.resolve(context.Background(), settings)
			}
			if (err != nil) != tc.wantErr {
				t.Fatalf("discovery err=%v, wantErr=%v", err, tc.wantErr)
			}
			if ex.httpClient == nil {
				return
			}
			// Test JWKS independently, so discovery failure cannot mask its TLS behavior.
			_, err = ex.jwks.get(context.Background(), ex.httpClient, endpoint+"/keys", false)
			if (err != nil) != tc.wantErr {
				t.Fatalf("JWKS err=%v, wantErr=%v", err, tc.wantErr)
			}
			if tc.wantErr {
				return
			}
			token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"iss": issuer, "aud": "grafana", "sub": "user", "exp": time.Now().Add(time.Minute).Unix()})
			token.Header["kid"] = "kid"
			raw, err := token.SignedString(key)
			if err != nil {
				t.Fatal(err)
			}
			identity, err := ex.verifyKeyrockIDToken(context.Background(), raw, settings)
			if err != nil || identity.Subject != "user" {
				t.Fatalf("verify identity=%#v err=%v", identity, err)
			}
		})
	}
}

func TestIDPTLSCacheIsolationAndReplacement(t *testing.T) {
	var endpoint string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "openid-configuration") {
			_ = json.NewEncoder(w).Encode(discoveryDocument{Issuer: endpoint, JWKSURL: endpoint + "/keys"})
			return
		}
		_, _ = w.Write([]byte(`{"keys":[]}`))
	}))
	defer server.Close()
	endpoint = server.URL
	d := newDatasource(http.DefaultClient, nil, nil)
	settings := Settings{ProviderMode: providerModeOIDCDiscovery, OIDCIssuer: endpoint, OIDCAudience: "grafana", IDPTLSSkipVerify: true}
	ctx := idpContext(1, "a")
	first, err := d.idpExchanger(ctx, settings, Secrets{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := first.providers.resolve(context.Background(), settings); err != nil {
		t.Fatal(err)
	}
	if _, err := first.jwks.get(context.Background(), first.httpClient, endpoint+"/keys", false); err != nil {
		t.Fatal(err)
	}
	same, _ := d.idpExchanger(ctx, settings, Secrets{})
	if first.httpClient != same.httpClient {
		t.Fatal("unchanged settings must reuse client")
	}
	for _, other := range []backend.PluginContext{idpContext(1, "b"), idpContext(2, "a")} {
		ex, _ := d.idpExchanger(other, settings, Secrets{})
		if ex.httpClient == first.httpClient || ex.jwks == first.jwks || ex.providers == first.providers {
			t.Fatal("datasource/organization caches must be isolated")
		}
	}
	settings.IDPTLSSkipVerify = false
	strict, _ := d.idpExchanger(ctx, settings, Secrets{})
	if _, err := strict.providers.resolve(context.Background(), settings); err == nil {
		t.Fatal("strict discovery reused insecure cache")
	}
	if _, err := strict.jwks.get(context.Background(), strict.httpClient, endpoint+"/keys", false); err == nil {
		t.Fatal("strict JWKS reused insecure cache")
	}
	ca := Secrets{IDPTLSCACert: certificatePEM(server.Certificate())}
	trusted, err := d.idpExchanger(ctx, settings, ca)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := trusted.providers.resolve(context.Background(), settings); err != nil {
		t.Fatal(err)
	}
	if _, err := trusted.jwks.get(context.Background(), trusted.httpClient, endpoint+"/keys", false); err != nil {
		t.Fatal(err)
	}
	for _, secrets := range []Secrets{{}, {IDPTLSCACert: unrelatedCA(t)}} {
		ex, err := d.idpExchanger(ctx, settings, secrets)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := ex.providers.resolve(context.Background(), settings); err == nil {
			t.Fatal("CA removal/replacement reused discovery cache")
		}
		if _, err := ex.jwks.get(context.Background(), ex.httpClient, endpoint+"/keys", false); err == nil {
			t.Fatal("CA removal/replacement reused JWKS cache")
		}
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			config := settings
			config.IDPTLSSkipVerify = i%2 == 0
			ex, err := d.idpExchanger(ctx, config, ca)
			if err != nil {
				t.Error(err)
				return
			}
			if _, err := ex.providers.resolve(context.Background(), config); err != nil {
				t.Error(err)
			}
			if _, err := ex.jwks.get(context.Background(), ex.httpClient, endpoint+"/keys", false); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
}

func TestIDPTLSClientDoesNotMutateBase(t *testing.T) {
	config := &tls.Config{InsecureSkipVerify: true} // test deliberately insecure base
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = config
	base := &http.Client{Transport: transport, Timeout: time.Second}
	client, err := newIDPHTTPClient(base, Settings{}, Secrets{})
	if err != nil {
		t.Fatal(err)
	}
	configured := client.Transport.(*http.Transport)
	if !config.InsecureSkipVerify || transport.TLSClientConfig != config || base.Timeout != time.Second {
		t.Fatal("base client mutated")
	}
	if configured.TLSClientConfig.InsecureSkipVerify || configured.TLSClientConfig.MinVersion != tls.VersionTLS12 || client.Timeout != 30*time.Second || configured.Proxy == nil {
		t.Fatal("incorrect secure defaults or lost proxy")
	}
	req := httptest.NewRequest(http.MethodGet, "http://example.com", nil)
	if err := client.CheckRedirect(req, nil); err == nil {
		t.Fatal("skip verification must not enable HTTP")
	}
}

func TestIDPTLSKeyrockModes(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"keys":[]}`)) }))
	defer server.Close()
	for _, settings := range []Settings{
		{ProviderMode: providerModeKeyrock, KeyrockBaseURL: server.URL, KeyrockClientID: "grafana"},
		{KeyrockIssuer: server.URL, KeyrockJWKSURL: server.URL + "/keys", KeyrockAudience: "grafana"},
	} {
		for _, skip := range []bool{false, true} {
			settings.IDPTLSSkipVerify = skip
			ex, err := newDatasource(http.DefaultClient, nil, nil).idpExchanger(idpContext(1, "a"), settings, Secrets{})
			if err != nil {
				t.Fatal(err)
			}
			provider, err := ex.providers.resolve(context.Background(), settings)
			if err != nil {
				t.Fatal(err)
			}
			_, err = ex.jwks.get(context.Background(), ex.httpClient, provider.JWKSURL, false)
			if (err == nil) != skip {
				t.Fatalf("Keyrock skip=%v err=%v", skip, err)
			}
		}
	}
}

func TestParseIDPTLSSettings(t *testing.T) {
	settings, secrets, err := parseSettings([]byte(`{"idpTlsSkipVerify":true}`), map[string]string{"idpTlsCACert": "idp", "tlsCACert": "doris"})
	if err != nil || !settings.IDPTLSSkipVerify || secrets.IDPTLSCACert != "idp" || secrets.TLSCACert != "doris" {
		t.Fatalf("settings=%#v secrets=%#v err=%v", settings, secrets, err)
	}
	settings, _, err = parseSettings([]byte(`{}`), nil)
	if err != nil || settings.IDPTLSSkipVerify {
		t.Fatal("verification must be enabled by default")
	}
}

func TestDatasourceIDPTLSHealthAndQuery(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var endpoint string
	var brokenJWKS atomic.Bool
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/.well-known/openid-configuration" {
			_ = json.NewEncoder(w).Encode(discoveryDocument{Issuer: endpoint, JWKSURL: endpoint + "/keys"})
			return
		}
		if brokenJWKS.Load() {
			_, _ = w.Write([]byte("invalid json"))
			return
		}
		writeJWKS(w, &key.PublicKey, "kid")
	}))
	defer server.Close()
	endpoint = server.URL
	d := newDatasource(http.DefaultClient, &SSOProfile{Issuer: "https://grafana.example/sso", SigningKey: key, SigningKeyID: "doris-key"}, nil)
	// This test checks outgoing IDP requests, not the deployment JWKS listener.
	d.listenerOnce.Do(func() {})
	ctx := idpContext(1, "a")
	settings := Settings{EnableSSO: true, Host: "doris.example", ProviderMode: providerModeOIDCDiscovery, OIDCIssuer: endpoint, OIDCAudience: "grafana"}
	check := func(secrets map[string]string, wantStatus backend.HealthStatus, message string) {
		t.Helper()
		ctx.DataSourceInstanceSettings.JSONData, _ = json.Marshal(settings)
		ctx.DataSourceInstanceSettings.DecryptedSecureJSONData = secrets
		result, err := d.CheckHealth(context.Background(), &backend.CheckHealthRequest{PluginContext: ctx})
		if err != nil || result.Status != wantStatus || !strings.Contains(result.Message, message) {
			t.Fatalf("health=%#v err=%v", result, err)
		}
	}
	check(nil, backend.HealthStatusError, "fetch OIDC discovery")
	settings.IDPTLSSkipVerify = true
	check(nil, backend.HealthStatusOk, "SSO verification pending")
	settings.IDPTLSSkipVerify = false
	check(map[string]string{"idpTlsCACert": "invalid"}, backend.HealthStatusError, "IDP TLS CA certificate")
	check(map[string]string{"idpTlsCACert": certificatePEM(server.Certificate())}, backend.HealthStatusOk, "SSO verification pending")
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"iss": endpoint, "aud": "grafana", "sub": "user", "exp": time.Now().Add(time.Minute).Unix()})
	token.Header["kid"] = "kid"
	raw, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	response, err := d.QueryData(context.Background(), &backend.QueryDataRequest{PluginContext: ctx, Headers: map[string]string{idTokenHeader: raw}})
	if err != nil || response == nil {
		t.Fatalf("query identity verification failed: %v", err)
	}
	brokenJWKS.Store(true)
	// Save & test must fetch JWKS even after a successful verification cached it.
	check(ctx.DataSourceInstanceSettings.DecryptedSecureJSONData, backend.HealthStatusError, "decode OIDC JWKS")
	settings.EnableSSO = false
	ctx.DataSourceInstanceSettings.JSONData, _ = json.Marshal(settings)
	ctx.DataSourceInstanceSettings.DecryptedSecureJSONData = map[string]string{"idpTlsCACert": "invalid"}
	if _, err := d.QueryData(context.Background(), &backend.QueryDataRequest{PluginContext: ctx}); err != nil {
		t.Fatalf("basic mode should ignore IDP CA: %v", err)
	}
}

func TestIDPTLSRedirects(t *testing.T) {
	for _, allowHTTP := range []bool{false, true} {
		client, err := newIDPHTTPClient(http.DefaultClient, Settings{IDPTLSSkipVerify: true, AllowInsecureIDP: allowHTTP}, Secrets{})
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodGet, "http://idp.example/keys", nil)
		previous := httptest.NewRequest(http.MethodGet, "https://idp.example/discovery", nil)
		if err := client.CheckRedirect(request, []*http.Request{previous}); err == nil {
			t.Fatal("HTTPS redirects must not downgrade even in local HTTP mode")
		}
		request = httptest.NewRequest(http.MethodGet, "https://idp.example/keys?version=1", nil)
		if err := client.CheckRedirect(request, []*http.Request{previous}); err != nil {
			t.Fatalf("valid HTTPS redirect rejected: %v", err)
		}
	}
}
