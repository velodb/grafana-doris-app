package plugin

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestVerifyAndExchangeKeyrockToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { writeJWKS(w, &key.PublicKey, "keyrock-key") }))
	defer server.Close()
	settings := Settings{KeyrockIssuer: "https://keyrock.example", KeyrockAudience: "grafana-client", KeyrockJWKSURL: server.URL}
	dorisIssuer, dorisAudience, keyID := "https://grafana.example/doris", "velodb-doris:test", "doris-key"
	input := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"iss": settings.KeyrockIssuer, "aud": settings.KeyrockAudience, "sub": "user-123", "groups": []string{"/team/readers", "/team/ops"}, "exp": time.Now().Add(time.Minute).Unix()})
	input.Header["kid"] = "keyrock-key"
	raw, err := input.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	exchanger := tokenExchanger{httpClient: server.Client()}
	identity, err := exchanger.verifyKeyrockIDToken(context.Background(), raw, settings)
	if err != nil {
		t.Fatal(err)
	}
	if identity.Subject != "user-123" {
		t.Fatalf("subject = %q", identity.Subject)
	}
	output, err := exchanger.issueDorisToken(identity.Subject, identity.Groups, dorisIssuer, dorisAudience, keyID, key)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(output, func(token *jwt.Token) (any, error) { return &key.PublicKey, nil }, jwt.WithIssuer(dorisIssuer), jwt.WithAudience(dorisAudience))
	if err != nil {
		t.Fatal(err)
	}
	claims := parsed.Claims.(jwt.MapClaims)
	if claims["username"] != "user-123" || claims["scope"] != "doris.query" {
		t.Fatalf("unexpected Doris claims: %#v", claims)
	}
	groups, ok := claims["doris_groups"].([]any)
	if !ok || len(groups) != 2 || groups[0] != "/team/readers" || groups[1] != "/team/ops" {
		t.Fatalf("unexpected Doris groups: %#v", claims["doris_groups"])
	}
	standardGroups, ok := claims["groups"].([]any)
	if !ok || len(standardGroups) != 2 || standardGroups[0] != "/team/readers" || standardGroups[1] != "/team/ops" {
		t.Fatalf("unexpected standard groups: %#v", claims["groups"])
	}
}

func TestRejectsWrongAudienceAndAlgorithm(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { writeJWKS(w, &key.PublicKey, "kid") }))
	defer server.Close()
	settings := Settings{KeyrockIssuer: "issuer", KeyrockAudience: "expected", KeyrockJWKSURL: server.URL}
	input := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"iss": "issuer", "aud": "wrong", "sub": "u", "exp": time.Now().Add(time.Minute).Unix()})
	input.Header["kid"] = "kid"
	raw, _ := input.SignedString(key)
	if _, err := (tokenExchanger{httpClient: server.Client()}).verifyKeyrockIDToken(context.Background(), raw, settings); err == nil {
		t.Fatal("expected audience validation failure")
	}
}

func TestAcceptsSingleRS256JWKWithoutKID(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { writeJWKS(w, &key.PublicKey, "only-key") }))
	defer server.Close()
	settings := Settings{KeyrockIssuer: "issuer", KeyrockAudience: "expected", KeyrockJWKSURL: server.URL}
	input := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"iss": "issuer", "aud": "expected", "sub": "u", "exp": time.Now().Add(time.Minute).Unix()})
	raw, _ := input.SignedString(key)
	identity, err := (tokenExchanger{httpClient: server.Client()}).verifyKeyrockIDToken(context.Background(), raw, settings)
	if err != nil || identity.Subject != "u" {
		t.Fatalf("expected a valid token without kid, subject=%q err=%v", identity.Subject, err)
	}
}

func TestRejectsMissingExpiredNotActiveAndMalformedOIDCTokens(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJWKS(w, &key.PublicKey, "kid")
	}))
	defer server.Close()
	settings := Settings{KeyrockIssuer: "issuer", KeyrockAudience: "audience", KeyrockJWKSURL: server.URL}
	exchanger := tokenExchanger{httpClient: server.Client(), jwks: newJWKSCache()}

	if _, err := exchanger.verifyKeyrockIDToken(context.Background(), "", settings); err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("expected missing token rejection, got %v", err)
	}

	for name, claims := range map[string]jwt.MapClaims{
		"expired":         {"iss": "issuer", "aud": "audience", "sub": "user", "exp": time.Now().Add(-time.Minute).Unix()},
		"not active":      {"iss": "issuer", "aud": "audience", "sub": "user", "exp": time.Now().Add(time.Minute).Unix(), "nbf": time.Now().Add(time.Minute).Unix()},
		"missing subject": {"iss": "issuer", "aud": "audience", "exp": time.Now().Add(time.Minute).Unix()},
		"invalid groups":  {"iss": "issuer", "aud": "audience", "sub": "user", "exp": time.Now().Add(time.Minute).Unix(), "groups": []any{"readers", 1}},
	} {
		t.Run(name, func(t *testing.T) {
			input := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
			input.Header["kid"] = "kid"
			raw, err := input.SignedString(key)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := exchanger.verifyKeyrockIDToken(context.Background(), raw, settings); err == nil {
				t.Fatal("expected token rejection")
			}
		})
	}
}

func TestRefreshesJWKSWhenTokenUsesRotatedKey(t *testing.T) {
	oldKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	newKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "max-age=3600")
		if requests.Add(1) == 1 {
			writeJWKS(w, &oldKey.PublicKey, "old-kid")
			return
		}
		writeJWKS(w, &newKey.PublicKey, "new-kid")
	}))
	defer server.Close()

	input := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss": "issuer", "aud": "audience", "sub": "rotated-user", "exp": time.Now().Add(time.Minute).Unix(),
	})
	input.Header["kid"] = "new-kid"
	raw, err := input.SignedString(newKey)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := (tokenExchanger{httpClient: server.Client(), jwks: newJWKSCache()}).verifyKeyrockIDToken(context.Background(), raw, Settings{
		KeyrockIssuer: "issuer", KeyrockAudience: "audience", KeyrockJWKSURL: server.URL,
	})
	if err != nil || identity.Subject != "rotated-user" {
		t.Fatalf("expected rotated key to validate, identity=%#v err=%v", identity, err)
	}
	if requests.Load() != 2 {
		t.Fatalf("expected initial lookup plus forced refresh, got %d requests", requests.Load())
	}
}

func TestStringGroups(t *testing.T) {
	groups, err := stringGroups([]any{"/doris-readers", "/doris-writers"})
	if err != nil || len(groups) != 2 || groups[1] != "/doris-writers" {
		t.Fatalf("unexpected groups=%#v err=%v", groups, err)
	}
	groups, err = stringGroups("/doris-readers")
	if err != nil || len(groups) != 1 || groups[0] != "/doris-readers" {
		t.Fatalf("unexpected single group=%#v err=%v", groups, err)
	}
	if _, err := stringGroups([]any{"/doris-readers", 1}); err == nil {
		t.Fatal("expected invalid group member failure")
	}
	if _, err := stringGroups(map[string]any{"group": "/doris-readers"}); err == nil {
		t.Fatal("expected invalid groups type failure")
	}
}

func TestPrivateKeyIsParsedOnlyFromSecureValue(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	pemValue := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	if _, err := parsePrivateKey(pemValue); err != nil {
		t.Fatal(err)
	}
	if _, err := parsePrivateKey("not-a-key"); err == nil {
		t.Fatal("expected invalid PEM failure")
	}
}

func TestSettingsDefaultToOIDCDiscoveryButKeepLegacyKeyrock(t *testing.T) {
	settings, _, err := parseSettings([]byte(`{"oidcIssuer":"https://idp.example","oidcAudience":"grafana"}`), nil)
	if err != nil || settings.ProviderMode != providerModeOIDCDiscovery {
		t.Fatalf("expected OIDC Discovery default, settings=%#v err=%v", settings, err)
	}
	legacy, _, err := parseSettings([]byte(`{"keyrockIssuer":"https://keyrock.example","keyrockJwksUrl":"https://keyrock.example/certs","keyrockAudience":"grafana"}`), nil)
	if err != nil || legacy.ProviderMode != "" {
		t.Fatalf("expected legacy Keyrock configuration to remain implicit, settings=%#v err=%v", legacy, err)
	}
}
