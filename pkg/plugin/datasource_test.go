package plugin

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestProfileResourceDoesNotExposeSigningKey(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	datasource := newDatasource(http.DefaultClient, &SSOProfile{
		Issuer: "https://grafana.example/doris-sso", JWKSPublicURL: "https://grafana.example/.well-known/jwks.json", JWKSListenAddr: ":0", SigningKeyID: "key-1", SigningKey: key,
	}, nil)
	var response *backend.CallResourceResponse
	err = datasource.CallResource(context.Background(), &backend.CallResourceRequest{
		Method: http.MethodGet, Path: "profile",
		PluginContext: backend.PluginContext{DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{UID: "datasource-a"}},
	}, backend.CallResourceResponseSenderFunc(func(value *backend.CallResourceResponse) error { response = value; return nil }))
	if err != nil || response == nil || response.Status != http.StatusOK {
		t.Fatalf("unexpected resource response: %#v err=%v", response, err)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body, &body); err != nil {
		t.Fatal(err)
	}
	if body["audience"] != "velodb-doris:datasource-a" || body["signingPrivateKey"] != nil {
		t.Fatalf("unexpected public profile response: %#v", body)
	}
}

func TestProfileResourceDerivesAudiencePerDatasource(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	datasource := newDatasource(http.DefaultClient, &SSOProfile{
		Issuer: "https://grafana.example/doris-sso", JWKSPublicURL: "https://grafana.example/.well-known/jwks.json", JWKSListenAddr: ":0", SigningKeyID: "key-1", SigningKey: key,
	}, nil)
	readAudience := func(uid string) string {
		var response *backend.CallResourceResponse
		err := datasource.CallResource(context.Background(), &backend.CallResourceRequest{
			Method: http.MethodGet, Path: "profile",
			PluginContext: backend.PluginContext{DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{UID: uid}},
		}, backend.CallResourceResponseSenderFunc(func(value *backend.CallResourceResponse) error { response = value; return nil }))
		if err != nil || response == nil || response.Status != http.StatusOK {
			t.Fatalf("unexpected resource response: %#v err=%v", response, err)
		}
		var body map[string]any
		if err := json.Unmarshal(response.Body, &body); err != nil {
			t.Fatal(err)
		}
		return body["audience"].(string)
	}
	if first, second := readAudience("datasource-a"), readAudience("datasource-b"); first != "velodb-doris:datasource-a" || second != "velodb-doris:datasource-b" || first == second {
		t.Fatalf("expected distinct deterministic audiences, got %q and %q", first, second)
	}
}

func TestProfileResourceReportsMissingProfile(t *testing.T) {
	datasource := newDatasource(http.DefaultClient, nil, context.Canceled)
	var response *backend.CallResourceResponse
	err := datasource.CallResource(context.Background(), &backend.CallResourceRequest{
		Method: http.MethodGet, Path: "profile",
		PluginContext: backend.PluginContext{DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{UID: "datasource-a"}},
	}, backend.CallResourceResponseSenderFunc(func(value *backend.CallResourceResponse) error { response = value; return nil }))
	if err != nil || response == nil || response.Status != http.StatusServiceUnavailable {
		t.Fatalf("unexpected resource response: %#v err=%v", response, err)
	}
}

func TestQueryDataRejectsMissingOIDCTokenBeforeDorisQuery(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	datasource := newDatasource(http.DefaultClient, &SSOProfile{
		Issuer: "https://grafana.example/doris-sso", JWKSPublicURL: "https://grafana.example/.well-known/jwks.json", JWKSListenAddr: ":0", SigningKeyID: "key-1", SigningKey: key,
	}, nil)
	settings, err := json.Marshal(map[string]any{
		"host": "doris.example", "oidcIssuer": "https://idp.example", "oidcAudience": "grafana",
	})
	if err != nil {
		t.Fatal(err)
	}
	model, err := json.Marshal(queryModel{RawSQL: "SELECT 1", Format: "table"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = datasource.QueryData(context.Background(), &backend.QueryDataRequest{
		PluginContext: backend.PluginContext{DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{UID: "datasource-a", JSONData: settings}},
		Queries:       []backend.DataQuery{{RefID: "A", JSON: model}},
	})
	if err == nil || !strings.Contains(err.Error(), "OIDC ID token is required") {
		t.Fatalf("expected token rejection before querying Doris, got %v", err)
	}
}
