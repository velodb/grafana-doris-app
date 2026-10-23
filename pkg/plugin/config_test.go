package plugin

import "testing"

func TestParseSettingsSupportsBasicAndSSOAuthenticationModes(t *testing.T) {
	basic, secrets, err := parseSettings([]byte(`{"host":"doris.example","username":"reader","enableSso":false}`), map[string]string{"password": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	if basic.EnableSSO || basic.OAuthPassThru || basic.Username != "reader" || secrets.Password != "secret" {
		t.Fatalf("expected basic authentication settings, got settings=%#v secrets=%#v", basic, secrets)
	}

	legacySSO, _, err := parseSettings([]byte(`{"oidcIssuer":"https://idp.example","oidcAudience":"grafana"}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !legacySSO.EnableSSO || !legacySSO.OAuthPassThru {
		t.Fatalf("expected existing OIDC datasource to preserve SSO mode, got %#v", legacySSO)
	}

	explicitBasic, _, err := parseSettings([]byte(`{"oidcIssuer":"https://idp.example","enableSso":false}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	if explicitBasic.EnableSSO || explicitBasic.OAuthPassThru {
		t.Fatalf("expected explicit basic mode to override retained OIDC settings, got %#v", explicitBasic)
	}
}
