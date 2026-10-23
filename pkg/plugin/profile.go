package plugin

import (
	"crypto/rsa"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

const (
	envSigningKeyFile    = "VELODB_DORIS_SSO_SIGNING_KEY_FILE"
	envIssuer            = "VELODB_DORIS_SSO_ISSUER"
	envJWKSPublicURL     = "VELODB_DORIS_SSO_JWKS_PUBLIC_URL"
	envJWKSListenAddr    = "VELODB_DORIS_SSO_JWKS_LISTEN_ADDR"
	envSigningKeyID      = "VELODB_DORIS_SSO_SIGNING_KEY_ID"
	envAllowInsecureHTTP = "VELODB_DORIS_SSO_ALLOW_INSECURE_HTTP"
)

type SSOProfile struct {
	Issuer         string
	JWKSPublicURL  string
	JWKSListenAddr string
	SigningKeyID   string
	SigningKey     *rsa.PrivateKey
}

func loadSSOProfileFromEnvironment() (*SSOProfile, error) {
	allowHTTP, err := strconv.ParseBool(defaultString(os.Getenv(envAllowInsecureHTTP), "false"))
	if err != nil {
		return nil, fmt.Errorf("Doris SSO Profile has an invalid %s value", envAllowInsecureHTTP)
	}
	issuer := strings.TrimSpace(os.Getenv(envIssuer))
	jwksURL := strings.TrimSpace(os.Getenv(envJWKSPublicURL))
	keyFile := strings.TrimSpace(os.Getenv(envSigningKeyFile))
	if issuer == "" || jwksURL == "" || keyFile == "" {
		return nil, fmt.Errorf("Doris SSO Profile is not configured; set %s, %s, and %s", envIssuer, envJWKSPublicURL, envSigningKeyFile)
	}
	if err := validateProfileURL(issuer, allowHTTP); err != nil {
		return nil, fmt.Errorf("Doris SSO Profile issuer: %w", err)
	}
	if err := validateProfileURL(jwksURL, allowHTTP); err != nil {
		return nil, fmt.Errorf("Doris SSO Profile JWKS URL: %w", err)
	}
	value, err := os.ReadFile(keyFile)
	if err != nil {
		return nil, fmt.Errorf("Doris SSO Profile signing key could not be loaded")
	}
	key, err := parsePrivateKey(string(value))
	if err != nil {
		return nil, fmt.Errorf("Doris SSO Profile signing key is invalid")
	}
	return &SSOProfile{
		Issuer:         issuer,
		JWKSPublicURL:  jwksURL,
		JWKSListenAddr: defaultString(strings.TrimSpace(os.Getenv(envJWKSListenAddr)), ":8999"),
		SigningKeyID:   defaultString(strings.TrimSpace(os.Getenv(envSigningKeyID)), "velodb-doris-sso"),
		SigningKey:     key,
	}, nil
}

func validateProfileURL(value string, allowHTTP bool) error {
	endpoint, err := url.Parse(value)
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return fmt.Errorf("must be an absolute URL")
	}
	if endpoint.Scheme != "https" && !(allowHTTP && endpoint.Scheme == "http") {
		return fmt.Errorf("must use HTTPS")
	}
	return nil
}

func (p *SSOProfile) audience(datasourceUID string) (string, error) {
	if strings.TrimSpace(datasourceUID) == "" {
		return "", fmt.Errorf("Datasource must be saved before its Doris token audience can be generated")
	}
	return "velodb-doris:" + datasourceUID, nil
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
