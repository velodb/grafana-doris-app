package plugin

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadSSOProfileFromEnvironment(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	keyFile := filepath.Join(t.TempDir(), "signing.pem")
	if err := os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(envSigningKeyFile, keyFile)
	t.Setenv(envIssuer, "https://grafana.example/doris-sso")
	t.Setenv(envJWKSPublicURL, "https://grafana.example/.well-known/jwks.json")
	t.Setenv(envJWKSListenAddr, ":0")
	profile, err := loadSSOProfileFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	if profile.SigningKey == nil || profile.SigningKeyID != "velodb-doris-sso" {
		t.Fatalf("unexpected profile: %#v", profile)
	}
	audience, err := profile.audience("datasource-a")
	if err != nil || audience != "velodb-doris:datasource-a" {
		t.Fatalf("unexpected audience=%q err=%v", audience, err)
	}
}

func TestProfileRejectsHTTPAndDoesNotLeakPrivateKey(t *testing.T) {
	secret := "do-not-leak-this-private-key"
	t.Setenv(envSigningKeyFile, "/missing/key.pem")
	t.Setenv(envIssuer, "http://grafana.example/doris-sso")
	t.Setenv(envJWKSPublicURL, "https://grafana.example/.well-known/jwks.json")
	_, err := loadSSOProfileFromEnvironment()
	if err == nil || !strings.Contains(err.Error(), "must use HTTPS") || strings.Contains(err.Error(), secret) {
		t.Fatalf("unexpected profile error: %v", err)
	}
}
