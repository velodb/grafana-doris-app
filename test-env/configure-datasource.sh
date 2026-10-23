#!/bin/sh
set -eu

grafana_url="${GRAFANA_URL:-http://grafana:3000}"
admin_user="${GRAFANA_ADMIN_USER:-admin}"
admin_password="${GRAFANA_ADMIN_PASSWORD:-admin}"
payload="$(jq -n '{
  name: "velodb-doris-datasource",
  uid: "velodb-doris-sso",
  type: "velodb-doris-datasource",
  access: "proxy",
  isDefault: true,
  jsonData: {
    host: "doris",
    port: 9030,
    database: "otel",
    enableSso: true,
    oauthPassThru: true,
    providerMode: "oidcDiscovery",
    oidcIssuer: "http://localhost:8085/realms/velodb",
    oidcAudience: "grafana-keycloak-local",
    oidcBackchannelUrl: "http://host.docker.internal:8085",
    allowInsecureIdp: true,
    tlsEnabled: true,
    tlsSkipVerify: true,
    groupRoleMappings: [
      { oidcGroup: "/doris-readers", dorisRole: "doris_reader" },
      { oidcGroup: "/doris-writers", dorisRole: "doris_writer" }
    ]
  }
}')"

# Grafana's local test database is intentionally ephemeral. Remove only this
# known datasource UID so every startup has exactly one configured SSO source.
curl --silent --show-error --fail-with-body \
  --retry 10 --retry-delay 1 --retry-all-errors \
  -u "$admin_user:$admin_password" \
  -X DELETE "$grafana_url/api/datasources/uid/velodb-doris-sso" >/dev/null 2>&1 || true

curl --silent --show-error --fail-with-body \
  --retry 10 --retry-delay 1 --retry-all-errors \
  -u "$admin_user:$admin_password" \
  -H 'Content-Type: application/json' \
  -X POST --data "$payload" \
  "$grafana_url/api/datasources" >/dev/null

echo "Configured velodb-doris-datasource with OIDC SSO"
