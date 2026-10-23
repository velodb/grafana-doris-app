package plugin

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestSSOHealthAndViewerQuery(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var issuer string
	idp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/.well-known/openid-configuration" {
			_ = json.NewEncoder(w).Encode(discoveryDocument{Issuer: issuer, JWKSURL: issuer + "/keys"})
			return
		}
		writeJWKS(w, &key.PublicKey, "kid")
	}))
	defer idp.Close()
	issuer = idp.URL
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"iss": issuer, "aud": "grafana", "sub": "user", "exp": time.Now().Add(time.Minute).Unix()})
	token.Header["kid"] = "kid"
	rawToken, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	certServer := httptest.NewTLSServer(http.NotFoundHandler())
	defer certServer.Close()
	certificate := certServer.TLS.Certificates[0]
	ca := certificatePEM(certServer.Certificate())

	for _, tc := range []struct {
		name, ca, serverName, token, failure, message string
		skip                                          bool
		want                                          backend.HealthStatus
		connect                                       bool
		query                                         bool
	}{
		{name: "untrusted self-signed", token: rawToken, want: backend.HealthStatusError, message: "certificate signed by unknown authority", connect: true},
		{name: "trusted CA", ca: ca, token: rawToken, want: backend.HealthStatusOk, message: "SELECT 1 succeeded", connect: true},
		{name: "explicit skip verification", skip: true, token: rawToken, want: backend.HealthStatusOk, message: "SELECT 1 succeeded", connect: true},
		{name: "hostname mismatch", ca: ca, serverName: "wrong.invalid", token: rawToken, want: backend.HealthStatusError, message: "certificate is valid for", connect: true},
		{name: "invalid CA", ca: "invalid", token: rawToken, want: backend.HealthStatusError, message: "Doris TLS CA certificate is invalid"},
		{name: "authentication rejected", ca: ca, token: rawToken, failure: "auth", want: backend.HealthStatusError, message: "Access denied", connect: true},
		{name: "query rejected", ca: ca, token: rawToken, failure: "query", want: backend.HealthStatusError, message: "SELECT denied", connect: true},
		{name: "missing identity", want: backend.HealthStatusOk, message: "SSO verification pending"},
		{name: "invalid identity", token: "invalid", want: backend.HealthStatusError, message: "OIDC ID token validation failed"},
		{name: "viewer query verifies SSO", ca: ca, token: rawToken, want: backend.HealthStatusOk, connect: true, query: true},
		{name: "viewer query requires identity", want: backend.HealthStatusError, message: "OIDC ID token is required", query: true},
		{name: "viewer query rejects invalid identity", token: "invalid", want: backend.HealthStatusError, message: "OIDC ID token validation failed", query: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			served := make(chan error, 1)
			var connected atomic.Bool
			go func() {
				conn, err := listener.Accept()
				if err == nil {
					connected.Store(true)
					defer conn.Close()
					_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
					err = serveHealthMySQL(conn, certificate, key, tc.failure)
				}
				served <- err
			}()
			host, port, _ := net.SplitHostPort(listener.Addr().String())
			portNumber, _ := strconv.Atoi(port)
			settings := Settings{EnableSSO: true, Host: host, Port: portNumber, ProviderMode: providerModeOIDCDiscovery, OIDCIssuer: issuer, OIDCAudience: "grafana", AllowInsecureIDP: true, TLSSkipVerify: tc.skip, TLSServerName: tc.serverName}
			ctx := idpContext(1, "health")
			ctx.User = &backend.User{Login: "admin", Role: "Admin"}
			if tc.query {
				ctx.User = &backend.User{Login: "user", Role: "Viewer"}
			}
			ctx.DataSourceInstanceSettings.JSONData, _ = json.Marshal(settings)
			ctx.DataSourceInstanceSettings.DecryptedSecureJSONData = map[string]string{"tlsCACert": tc.ca}
			d := newDatasource(http.DefaultClient, &SSOProfile{Issuer: "https://grafana.example/sso", SigningKey: key, SigningKeyID: "doris-key"}, nil)
			d.listenerOnce.Do(func() {})
			if tc.query {
				model, _ := json.Marshal(queryModel{RawSQL: "SELECT 1", Format: "table"})
				req := &backend.QueryDataRequest{PluginContext: ctx, Queries: []backend.DataQuery{{RefID: "A", JSON: model}}}
				req.SetHTTPHeader(idTokenHeader, tc.token)
				result, err := d.QueryData(context.Background(), req)
				if tc.want == backend.HealthStatusOk {
					if err != nil || result == nil {
						t.Fatalf("viewer query failed: result=%#v err=%v", result, err)
					}
					response := result.Responses["A"]
					if response.Error != nil || len(response.Frames) != 1 || response.Frames[0].Rows() != 1 {
						t.Fatalf("expected SELECT 1 result: %#v", response)
					}
				} else {
					if err != nil || result == nil {
						t.Fatalf("expected an unmasked query identity rejection: result=%#v err=%v", result, err)
					}
					response := result.Responses["A"]
					if response.Error == nil || !strings.Contains(response.Error.Error(), tc.message) {
						t.Fatalf("expected query identity rejection %q, got %#v", tc.message, response)
					}
				}
			} else {
				req := &backend.CheckHealthRequest{PluginContext: ctx}
				req.SetHTTPHeader(idTokenHeader, tc.token)
				result, err := d.CheckHealth(context.Background(), req)
				if err != nil || result.Status != tc.want || !strings.Contains(result.Message, tc.message) {
					t.Fatalf("health=%#v err=%v", result, err)
				}
				if tc.token == "" && (!strings.Contains(result.Message, "Doris connection and TLS certificate have not been verified") || !strings.Contains(result.Message, "datasource management permissions are not required")) {
					t.Fatalf("pending health must explain what remains unverified and how a query user can verify it: %s", result.Message)
				}
			}
			if !tc.connect {
				_ = listener.Close()
			}
			serverErr := <-served
			if tc.connect && tc.want == backend.HealthStatusOk && serverErr != nil {
				t.Fatalf("MySQL fixture: %v", serverErr)
			}
			if !tc.connect && connected.Load() {
				t.Fatal("unexpected Doris connection before configuration/identity validation")
			}
		})
	}
}

// Speak the MySQL protocol over a real TLS socket so health checks exercise
// certificate verification, OIDC token delivery, and SELECT 1 through the driver.
func serveHealthMySQL(conn net.Conn, certificate tls.Certificate, key *rsa.PrivateKey, failure string) error {
	readPacket := func(reader io.Reader) ([]byte, error) {
		var header [4]byte
		if _, err := io.ReadFull(reader, header[:]); err != nil {
			return nil, err
		}
		length := int(header[0]) | int(header[1])<<8 | int(header[2])<<16
		packet := make([]byte, length)
		_, err := io.ReadFull(reader, packet)
		return packet, err
	}
	writePacket := func(writer io.Writer, sequence byte, payload []byte) error {
		header := []byte{byte(len(payload)), byte(len(payload) >> 8), byte(len(payload) >> 16), sequence}
		_, err := writer.Write(append(header, payload...))
		return err
	}
	// Protocol 4.1, SSL, secure connection, and plugin authentication.
	flags := uint32(1<<9 | 1<<11 | 1<<15 | 1<<19)
	hello := append([]byte{10}, []byte("8.0.0-health\x00")...)
	hello = append(hello, 1, 0, 0, 0)
	hello = append(hello, []byte("12345678")...)
	hello = append(hello, 0, byte(flags), byte(flags>>8), 45, 2, 0, byte(flags>>16), byte(flags>>24), 21)
	hello = append(hello, make([]byte, 10)...)
	hello = append(hello, []byte("abcdefghijkl\x00authentication_openid_connect_client\x00")...)
	if err := writePacket(conn, 0, hello); err != nil {
		return err
	}
	sslRequest, err := readPacket(conn)
	if err != nil {
		return err
	}
	if len(sslRequest) != 32 || binary.LittleEndian.Uint32(sslRequest[:4])&(1<<11) == 0 {
		return fmt.Errorf("expected MySQL SSL request")
	}
	secure := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
	if err := secure.Handshake(); err != nil {
		return err
	}
	auth, err := readPacket(secure)
	if err != nil {
		return err
	}
	if len(auth) < 40 || !bytes.HasPrefix(auth[32:], []byte("user\x00")) || !bytes.Contains(auth, []byte("authentication_openid_connect_client")) {
		return fmt.Errorf("expected user and OIDC authentication plugin")
	}
	// The outer auth data is length encoded; the JWT inside ends at its length.
	pos := 37
	if auth[pos] == 0xfc {
		pos += 3
	} else {
		pos++
	}
	if auth[pos] != 1 || auth[pos+1] != 0xfc {
		return fmt.Errorf("expected OIDC capability and JWT length")
	}
	length := int(binary.LittleEndian.Uint16(auth[pos+2 : pos+4]))
	if len(auth) < pos+4+length {
		return fmt.Errorf("truncated OIDC JWT")
	}
	if _, err := jwt.Parse(string(auth[pos+4:pos+4+length]), func(*jwt.Token) (any, error) { return &key.PublicKey, nil }, jwt.WithIssuer("https://grafana.example/sso"), jwt.WithAudience("velodb-doris:health"), jwt.WithValidMethods([]string{"RS256"})); err != nil {
		return fmt.Errorf("unexpected exchanged Doris token: %w", err)
	}
	errorPacket := func(message string) []byte {
		return append([]byte{0xff, 0x15, 0x04, '#', '2', '8', '0', '0', '0'}, []byte(message)...)
	}
	if failure == "auth" {
		return writePacket(secure, 3, errorPacket("Access denied"))
	}
	if err := writePacket(secure, 3, []byte{0, 0, 0, 2, 0, 0, 0}); err != nil {
		return err
	}
	query, err := readPacket(secure)
	if err != nil {
		return err
	}
	if !bytes.Equal(query, append([]byte{3}, []byte("SELECT 1")...)) {
		return fmt.Errorf("expected SELECT 1, got %q", query)
	}
	if failure == "query" {
		return writePacket(secure, 1, errorPacket("SELECT denied"))
	}
	column := []byte{3, 'd', 'e', 'f', 0, 0, 0, 1, '1', 0, 12, 63, 0, 1, 0, 0, 0, 3, 0, 0, 0, 0, 0}
	eof := []byte{0xfe, 0, 0, 2, 0}
	for i, packet := range [][]byte{{1}, column, eof, {1, '1'}, eof} {
		if err := writePacket(secure, byte(i+1), packet); err != nil {
			return err
		}
	}
	return nil
}
