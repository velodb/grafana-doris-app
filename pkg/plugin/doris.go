package plugin

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"fmt"
	"net"
	"strings"
	"time"

	gomysql "github.com/go-sql-driver/mysql"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// queryDorisOIDC opens a one-query, one-user TLS connection. The vendored
// driver patch implements authentication_openid_connect_client. The token has
// a dedicated provider and is never stored in the driver's password field.
// A narrow, internal flag is used for extended VARIANT descriptions because
// Doris stores that setting at connection scope.
func queryDorisOIDC(ctx context.Context, settings Settings, secrets Secrets, username, identityToken, statement string, describeExtendVariantColumn bool) (*data.Frame, error) {
	if settings.Host == "" {
		return nil, fmt.Errorf("Doris host is required")
	}
	if len(identityToken) == 0 || len(identityToken) > 10_000 {
		return nil, fmt.Errorf("invalid Doris identity token")
	}
	tlsConfig, err := dorisTLSConfig(settings, secrets)
	if err != nil {
		return nil, err
	}
	config := gomysql.NewConfig()
	config.User, config.Net = username, "tcp"
	config.Addr = net.JoinHostPort(settings.Host, fmt.Sprintf("%d", settings.Port))
	config.DBName, config.TLS = settings.Database, tlsConfig
	config.OIDCEnabled = true
	config.OIDCTokenProvider = func() (string, error) { return identityToken, nil }
	config.Timeout, config.ReadTimeout, config.WriteTimeout = 10*time.Second, 30*time.Second, 30*time.Second
	config.AllowFallbackToPlaintext = false
	return queryDorisWithConfig(ctx, config, statement, describeExtendVariantColumn, "Doris OIDC")
}

func queryDorisBasic(ctx context.Context, settings Settings, secrets Secrets, statement string, describeExtendVariantColumn bool) (*data.Frame, error) {
	if settings.Host == "" {
		return nil, fmt.Errorf("Doris host is required")
	}
	if settings.Username == "" {
		return nil, fmt.Errorf("Doris username is required when SSO is disabled")
	}
	tlsConfig, err := dorisTLSConfig(settings, secrets)
	if err != nil {
		return nil, err
	}
	config := gomysql.NewConfig()
	config.User, config.Passwd, config.Net = settings.Username, secrets.Password, "tcp"
	config.Addr = net.JoinHostPort(settings.Host, fmt.Sprintf("%d", settings.Port))
	config.DBName, config.TLS = settings.Database, tlsConfig
	config.Timeout, config.ReadTimeout, config.WriteTimeout = 10*time.Second, 30*time.Second, 30*time.Second
	config.AllowFallbackToPlaintext = false
	return queryDorisWithConfig(ctx, config, statement, describeExtendVariantColumn, "Doris")
}

func queryDorisWithConfig(ctx context.Context, config *gomysql.Config, statement string, describeExtendVariantColumn bool, connectionName string) (*data.Frame, error) {
	connector, err := gomysql.NewConnector(config)
	if err != nil {
		return nil, fmt.Errorf("configure %s connection: %w", connectionName, err)
	}
	db := sql.OpenDB(connector)
	defer db.Close()
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("open %s connection: %w", connectionName, err)
	}
	defer conn.Close()
	if describeExtendVariantColumn {
		if _, err := conn.ExecContext(ctx, "SET describe_extend_variant_column = true"); err != nil {
			return nil, fmt.Errorf("enable extended VARIANT descriptions: %w", err)
		}
	}
	rows, err := conn.QueryContext(ctx, statement)
	if err != nil {
		return nil, fmt.Errorf("%s query failed: %w", connectionName, err)
	}
	defer rows.Close()
	return rowsToFrame(rows)
}

func dorisTLSConfig(settings Settings, secrets Secrets) (*tls.Config, error) {
	// Basic username/password connections may target a local Doris FE that
	// does not expose TLS. SSO always requires TLS because it transports an
	// identity token. Existing TLS configurations remain enabled when a server
	// name or CA certificate was supplied before the toggle existed.
	if !settings.EnableSSO && !settings.TLSEnabled && settings.TLSServerName == "" && secrets.TLSCACert == "" {
		return nil, nil
	}
	config := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: settings.TLSServerName, InsecureSkipVerify: settings.TLSSkipVerify} // #nosec G402 -- explicit test-only datasource option
	if config.ServerName == "" {
		config.ServerName = settings.Host
	}
	if secrets.TLSCACert != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(secrets.TLSCACert)) {
			return nil, fmt.Errorf("Doris TLS CA certificate is invalid")
		}
		config.RootCAs = pool
	}
	return config, nil
}

func rowsToFrame(rows *sql.Rows) (*data.Frame, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	// Grafana fields must be backed by a concrete, homogeneous Go slice. The
	// MySQL driver returns each scanned value as `any`, so retain the portable
	// table representation as strings instead of passing an unsupported []any
	// to data.NewField.
	values := make([][]string, len(columns))
	for index := range values {
		values[index] = []string{}
	}
	for rows.Next() {
		scanned := make([]any, len(columns))
		destinations := make([]any, len(columns))
		for index := range scanned {
			destinations[index] = &scanned[index]
		}
		if err := rows.Scan(destinations...); err != nil {
			return nil, err
		}
		for index, value := range scanned {
			if bytes, ok := value.([]byte); ok {
				values[index] = append(values[index], string(bytes))
			} else {
				values[index] = append(values[index], fmt.Sprint(value))
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	fields := make([]*data.Field, len(columns))
	for index, column := range columns {
		fields[index] = data.NewField(strings.TrimSpace(column), nil, values[index])
	}
	return data.NewFrame("doris", fields...), nil
}
