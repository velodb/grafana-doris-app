package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// TestLocalDorisOIDCE2E is opt-in because it needs the local Docker stack and
// an ID token supplied by the test harness. It exercises the real Go OIDC
// MySQL authentication flow rather than a mocked driver.
func TestLocalDorisOIDCE2E(t *testing.T) {
	idToken := os.Getenv("VELODB_DORIS_E2E_ID_TOKEN")
	if idToken == "" {
		t.Skip("set VELODB_DORIS_E2E_ID_TOKEN to run against the local Docker stack")
	}
	profile, err := loadSSOProfileFromEnvironment()
	if err != nil {
		t.Fatalf("load deployment SSO Profile: %v", err)
	}
	datasource := newDatasource(http.DefaultClient, profile, nil)
	settings, err := json.Marshal(map[string]any{
		"host":             "127.0.0.1",
		"port":             19030,
		"database":         "otel",
		"providerMode":     "oidcDiscovery",
		"oidcIssuer":       "http://localhost:8085/realms/velodb",
		"oidcAudience":     "grafana-keycloak-local",
		"allowInsecureIdp": true,
		"dorisRole":        "doris_reader",
		"groupRoleMappings": []map[string]string{
			{"oidcGroup": "/doris-readers", "dorisRole": "doris_reader"},
			{"oidcGroup": "/doris-writers", "dorisRole": "doris_writer"},
		},
		"tlsSkipVerify": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	model, err := json.Marshal(queryModel{RawSQL: "SELECT CURRENT_USER(), COUNT(*) FROM otel.otel_logs", Format: "table"})
	if err != nil {
		t.Fatal(err)
	}
	req := &backend.QueryDataRequest{
		PluginContext: backend.PluginContext{DataSourceInstanceSettings: &backend.DataSourceInstanceSettings{UID: "velodb-doris-sso", JSONData: settings}},
		Queries:       []backend.DataQuery{{RefID: "A", JSON: model}},
	}
	req.SetHTTPHeader(idTokenHeader, idToken)
	response, err := datasource.QueryData(context.Background(), req)
	if err != nil {
		t.Fatalf("query datasource: %v", err)
	}
	if result := response.Responses["A"]; result.Error != nil || len(result.Frames) != 1 {
		t.Fatalf("unexpected Doris OIDC result: %#v", result)
	}
}
