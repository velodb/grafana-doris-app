package plugin

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

type idpClientKey struct {
	orgID int64
	uid   string
}
type idpClientEntry struct {
	fingerprint [32]byte
	exchanger   tokenExchanger
}
type idpClientCache struct {
	mu      sync.Mutex
	entries map[idpClientKey]idpClientEntry
}

// idpExchanger keeps transports and both IDP caches local to one datasource and
// one configuration. Replacing an entry never mutates clients used by in-flight queries.
func (d *Datasource) idpExchanger(ctx backend.PluginContext, settings Settings, secrets Secrets) (tokenExchanger, error) {
	raw, err := json.Marshal(settings)
	if err != nil {
		return tokenExchanger{}, err
	}
	caHash := sha256.Sum256([]byte(secrets.IDPTLSCACert))
	fingerprint := sha256.Sum256(append(raw, caHash[:]...))
	key := idpClientKey{orgID: ctx.OrgID, uid: ctx.DataSourceInstanceSettings.UID}
	d.idpClients.mu.Lock()
	defer d.idpClients.mu.Unlock()
	if entry, ok := d.idpClients.entries[key]; ok && entry.fingerprint == fingerprint {
		return entry.exchanger, nil
	}
	client, err := newIDPHTTPClient(d.exchanger.httpClient, settings, secrets)
	if err != nil {
		return tokenExchanger{}, err
	}
	exchanger := tokenExchanger{httpClient: client, providers: newProviderResolver(client), jwks: newJWKSCache()}
	if d.idpClients.entries == nil {
		d.idpClients.entries = make(map[idpClientKey]idpClientEntry)
	}
	if old, ok := d.idpClients.entries[key]; ok {
		old.exchanger.httpClient.CloseIdleConnections()
	}
	d.idpClients.entries[key] = idpClientEntry{fingerprint: fingerprint, exchanger: exchanger}
	return exchanger, nil
}

func newIDPHTTPClient(base *http.Client, settings Settings, secrets Secrets) (*http.Client, error) {
	if base == nil {
		base = http.DefaultClient
	}
	original := base.Transport
	if original == nil {
		original = http.DefaultTransport
	}
	transport, ok := original.(*http.Transport)
	if !ok {
		return nil, fmt.Errorf("IDP HTTP transport does not support TLS configuration")
	}
	cloned := transport.Clone()
	// Always use the system trust store rather than inheriting a different
	// datasource's TLS settings from the base transport.
	config := &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: settings.IDPTLSSkipVerify} // #nosec G402 -- explicit datasource option, disabled by default
	if secrets.IDPTLSCACert != "" {
		pool, err := x509.SystemCertPool()
		if err != nil {
			return nil, fmt.Errorf("load IDP system CA certificates: %w", err)
		}
		remaining := []byte(secrets.IDPTLSCACert)
		count := 0
		for len(bytes.TrimSpace(remaining)) > 0 {
			remaining = bytes.TrimSpace(remaining)
			if !bytes.HasPrefix(remaining, []byte("-----BEGIN CERTIFICATE-----")) {
				return nil, fmt.Errorf("IDP TLS CA certificate must be a PEM certificate bundle")
			}
			endMarker := []byte("-----END CERTIFICATE-----")
			end := bytes.Index(remaining, endMarker)
			if end < 0 {
				return nil, fmt.Errorf("IDP TLS CA certificate must be a PEM certificate bundle")
			}
			end += len(endMarker)
			block, undecoded := pem.Decode(remaining[:end])
			if block == nil || block.Type != "CERTIFICATE" || len(bytes.TrimSpace(undecoded)) != 0 {
				return nil, fmt.Errorf("IDP TLS CA certificate must be a PEM certificate bundle")
			}
			cert, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				return nil, fmt.Errorf("IDP TLS CA certificate is invalid: %w", err)
			}
			pool.AddCert(cert)
			count++
			remaining = remaining[end:]
		}
		if count == 0 {
			return nil, fmt.Errorf("IDP TLS CA certificate bundle is empty")
		}
		config.RootCAs = pool
	}
	cloned.TLSClientConfig = config
	client := *base
	client.Transport = cloned
	client.Timeout = 30 * time.Second
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" && !(settings.AllowInsecureIDP && req.URL.Scheme == "http") {
			return fmt.Errorf("IDP redirect must use HTTPS")
		}
		if len(via) > 0 && via[len(via)-1].URL.Scheme == "https" && req.URL.Scheme != "https" {
			return fmt.Errorf("IDP redirect must not downgrade HTTPS")
		}
		if base.CheckRedirect != nil {
			return base.CheckRedirect(req, via)
		}
		if len(via) >= 10 {
			return fmt.Errorf("stopped after 10 IDP redirects")
		}
		return nil
	}
	return &client, nil
}
