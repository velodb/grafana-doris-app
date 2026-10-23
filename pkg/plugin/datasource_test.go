package plugin

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
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
	response, err := datasource.QueryData(context.Background(), &backend.QueryDataRequest{
		PluginContext: backend.PluginContext{DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{UID: "datasource-a", JSONData: settings}},
		Queries:       []backend.DataQuery{{RefID: "A", JSON: model}},
	})
	if err != nil || response == nil {
		t.Fatalf("expected a query response rather than a masked plugin error, got response=%#v err=%v", response, err)
	}
	if result := response.Responses["A"]; result.Status != backend.StatusInternal || result.Error == nil || !strings.Contains(result.Error.Error(), "OIDC ID token is required") {
		t.Fatalf("expected token rejection before querying Doris, got %#v", result)
	}
}

func TestQueryDataExposesSetupErrorsForEveryQuery(t *testing.T) {
	for _, tc := range []struct {
		name        string
		settings    *backend.DataSourceInstanceSettings
		profile     *SSOProfile
		profileErr  error
		listenerErr error
		status      backend.Status
		message     string
	}{
		{name: "missing settings", status: backend.StatusBadRequest, message: "Doris datasource settings are missing"},
		{name: "invalid settings", settings: &backend.DataSourceInstanceSettings{JSONData: json.RawMessage(`{`)}, status: backend.StatusBadRequest, message: "invalid datasource configuration"},
		{name: "missing profile", settings: &backend.DataSourceInstanceSettings{UID: "test", JSONData: json.RawMessage(`{"enableSso":true}`)}, status: backend.StatusInternal, message: "Doris SSO Profile is not configured"},
		{name: "invalid profile", settings: &backend.DataSourceInstanceSettings{UID: "test", JSONData: json.RawMessage(`{"enableSso":true}`)}, profileErr: errors.New("Doris SSO Profile signing key is invalid"), status: backend.StatusInternal, message: "Doris SSO Profile signing key is invalid"},
		{name: "JWKS listener", settings: &backend.DataSourceInstanceSettings{UID: "test", JSONData: json.RawMessage(`{"enableSso":true}`)}, profile: &SSOProfile{}, listenerErr: errors.New("Doris SSO Profile JWKS listener could not start"), status: backend.StatusInternal, message: "JWKS listener could not start"},
		{name: "invalid IDP CA", settings: &backend.DataSourceInstanceSettings{UID: "test", JSONData: json.RawMessage(`{"enableSso":true}`), DecryptedSecureJSONData: map[string]string{"idpTlsCACert": "invalid"}}, profile: &SSOProfile{}, status: backend.StatusInternal, message: "IDP TLS CA certificate"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			datasource := newDatasource(http.DefaultClient, tc.profile, tc.profileErr)
			datasource.listenerOnce.Do(func() {})
			datasource.listenerErr = tc.listenerErr
			response, err := datasource.QueryData(context.Background(), &backend.QueryDataRequest{
				PluginContext: backend.PluginContext{DataSourceInstanceSettings: tc.settings},
				Queries:       []backend.DataQuery{{RefID: "A", JSON: json.RawMessage(`{"rawSql":"SELECT 1"}`)}, {RefID: "B", JSON: json.RawMessage(`{"rawSql":"SELECT 2"}`)}},
			})
			if err != nil || response == nil {
				t.Fatalf("expected query errors instead of a masked plugin error: response=%#v err=%v", response, err)
			}
			for _, refID := range []string{"A", "B"} {
				result, ok := response.Responses[refID]
				if !ok || result.Error == nil || result.Status != tc.status || !strings.Contains(result.Error.Error(), tc.message) || len(result.Frames) != 0 {
					t.Fatalf("query %s lost setup error %q: %#v", refID, tc.message, result)
				}
				// Check the SDK JSON serialization used in Grafana's results response.
				raw, err := json.Marshal(result)
				if err != nil || !strings.Contains(string(raw), tc.message) {
					t.Fatalf("query %s lost its public message when serialized: %s err=%v", refID, raw, err)
				}
			}
		})
	}
}
