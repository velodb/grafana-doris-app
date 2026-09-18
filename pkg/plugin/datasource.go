package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

const idTokenHeader = "X-ID-Token"

type Datasource struct {
	exchanger    tokenExchanger
	profile      *SSOProfile
	profileErr   error
	listenerOnce sync.Once
	listenerErr  error
}

func NewDatasource() *Datasource {
	client := http.DefaultClient
	profile, profileErr := loadSSOProfileFromEnvironment()
	datasource := newDatasource(client, profile, profileErr)
	if profileErr == nil {
		// The JWKS endpoint is deployment-wide, so start it with the plugin
		// process rather than waiting for the first datasource request.
		_ = datasource.ensureJWKS(profile)
	}
	return datasource
}

func newDatasource(client *http.Client, profile *SSOProfile, profileErr error) *Datasource {
	return &Datasource{exchanger: tokenExchanger{httpClient: client, providers: newProviderResolver(client), jwks: newJWKSCache()}, profile: profile, profileErr: profileErr}
}

type queryModel struct {
	RawSQL                      string `json:"rawSql"`
	Format                      string `json:"format"`
	DescribeExtendVariantColumn bool   `json:"describeExtendVariantColumn"`
}

func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	settings, secrets, err := parseSettings(req.PluginContext.DataSourceInstanceSettings.JSONData, req.PluginContext.DataSourceInstanceSettings.DecryptedSecureJSONData)
	if err != nil {
		return nil, err
	}
	var username, dorisToken string
	if settings.EnableSSO {
		profile, audience, err := d.profileForRequest(req.PluginContext.DataSourceInstanceSettings.UID)
		if err != nil {
			return nil, err
		}
		if err := d.ensureJWKS(profile); err != nil {
			return nil, err
		}
		identity, err := d.exchanger.verifyKeyrockIDToken(ctx, idTokenFromHeader(req.GetHTTPHeader(idTokenHeader)), settings)
		if err != nil {
			return nil, err
		}
		// Authorization is owned by Doris. Forward only the verified source groups;
		// the Doris administrator maps them to roles in the bootstrap SQL.
		dorisToken, err = d.exchanger.issueDorisToken(identity.Subject, identity.Groups, profile.Issuer, audience, profile.SigningKeyID, profile.SigningKey)
		if err != nil {
			return nil, err
		}
		username = identity.Subject
	}

	response := backend.NewQueryDataResponse()
	for _, query := range req.Queries {
		var model queryModel
		if err := json.Unmarshal(query.JSON, &model); err != nil {
			response.Responses[query.RefID] = backend.ErrDataResponse(backend.StatusBadRequest, "invalid query model")
			continue
		}
		if model.RawSQL == "" {
			response.Responses[query.RefID] = backend.ErrDataResponse(backend.StatusBadRequest, "SQL is required")
			continue
		}
		var frame *data.Frame
		if settings.EnableSSO {
			frame, err = queryDorisOIDC(ctx, settings, secrets, username, dorisToken, model.RawSQL, model.DescribeExtendVariantColumn)
		} else {
			frame, err = queryDorisBasic(ctx, settings, secrets, model.RawSQL, model.DescribeExtendVariantColumn)
		}
		if err != nil {
			response.Responses[query.RefID] = backend.ErrDataResponse(backend.StatusInternal, err.Error())
			continue
		}
		response.Responses[query.RefID] = backend.DataResponse{Frames: data.Frames{frame}}
	}
	return response, nil
}

func (d *Datasource) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	settings, secrets, err := parseSettings(req.PluginContext.DataSourceInstanceSettings.JSONData, req.PluginContext.DataSourceInstanceSettings.DecryptedSecureJSONData)
	if err != nil {
		return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: err.Error()}, nil
	}
	if settings.Host == "" {
		return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: "Doris connection configuration is incomplete"}, nil
	}
	if !settings.EnableSSO {
		if settings.Username == "" {
			return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: "Doris username is required when SSO is disabled"}, nil
		}
		if _, err := queryDorisBasic(ctx, settings, secrets, "SELECT 1", false); err != nil {
			return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: err.Error()}, nil
		}
		return &backend.CheckHealthResult{Status: backend.HealthStatusOk, Message: "Doris username/password connection succeeded"}, nil
	}
	profile, _, err := d.profileForRequest(req.PluginContext.DataSourceInstanceSettings.UID)
	if err != nil {
		return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: err.Error()}, nil
	}
	if err := d.ensureJWKS(profile); err != nil {
		return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: err.Error()}, nil
	}
	provider, err := d.exchanger.providers.resolve(ctx, settings)
	if err != nil {
		return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: err.Error()}, nil
	}
	return &backend.CheckHealthResult{Status: backend.HealthStatusOk, Message: "OIDC " + provider.Mode + " provider resolved; token exchange and Doris JWKS are configured"}, nil
}

func (d *Datasource) CallResource(_ context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	if req.Method != http.MethodGet || strings.Trim(req.Path, "/") != "profile" || req.PluginContext.DataSourceInstanceSettings == nil {
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusNotFound, Body: []byte("resource not found")})
	}
	profile, audience, err := d.profileForRequest(req.PluginContext.DataSourceInstanceSettings.UID)
	if err != nil {
		body, _ := json.Marshal(map[string]any{"configured": false, "message": err.Error()})
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusServiceUnavailable, Headers: map[string][]string{"Content-Type": {"application/json"}}, Body: body})
	}
	if err := d.ensureJWKS(profile); err != nil {
		body, _ := json.Marshal(map[string]any{"configured": false, "message": err.Error()})
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusServiceUnavailable, Headers: map[string][]string{"Content-Type": {"application/json"}}, Body: body})
	}
	body, _ := json.Marshal(map[string]any{"configured": true, "issuer": profile.Issuer, "jwksPublicUrl": profile.JWKSPublicURL, "signingKeyID": profile.SigningKeyID, "audience": audience})
	return sender.Send(&backend.CallResourceResponse{Status: http.StatusOK, Headers: map[string][]string{"Content-Type": {"application/json"}}, Body: body})
}

func (d *Datasource) profileForRequest(datasourceUID string) (*SSOProfile, string, error) {
	if d.profileErr != nil {
		return nil, "", d.profileErr
	}
	if d.profile == nil {
		return nil, "", fmt.Errorf("Doris SSO Profile is not configured")
	}
	audience, err := d.profile.audience(datasourceUID)
	if err != nil {
		return nil, "", err
	}
	return d.profile, audience, nil
}

func (d *Datasource) ensureJWKS(profile *SSOProfile) error {
	d.listenerOnce.Do(func() {
		listener, err := net.Listen("tcp", profile.JWKSListenAddr)
		if err != nil {
			d.listenerErr = fmt.Errorf("Doris SSO Profile JWKS listener could not start")
			return
		}
		mux := http.NewServeMux()
		mux.HandleFunc("/.well-known/jwks.json", func(w http.ResponseWriter, _ *http.Request) {
			writeJWKS(w, &profile.SigningKey.PublicKey, profile.SigningKeyID)
		})
		go func() { _ = http.Serve(listener, mux) }()
	})
	return d.listenerErr
}
