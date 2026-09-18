#!/bin/sh
set -eu

doris_host="${DORIS_HOST:-doris}"
doris_port="${DORIS_PORT:-9030}"
integration="velodb_local_oidc"
audience="velodb-doris:velodb-doris-sso"

doris_mysql() {
  mysql -h"$doris_host" -P"$doris_port" -uroot "$@"
}

if doris_mysql -N -e "SELECT COUNT(*) FROM information_schema.authentication_integrations WHERE name='${integration}'" | grep -qx '0'; then
  doris_mysql -e "CREATE AUTHENTICATION INTEGRATION ${integration} PROPERTIES (
    'type'='oidc',
    'enable_jit_user'='true',
    'oidc.issuer'='http://host.docker.internal:8999',
    'oidc.jwks_uri'='http://host.docker.internal:8999/.well-known/jwks.json',
    'oidc.allowed_audiences'='${audience}',
    'oidc.required_scopes'='doris.query',
    'oidc.allowed_client_ids'='velodb-doris-datasource',
    'oidc.username_claim'='username',
    'oidc.subject_claim'='sub',
    'oidc.groups_claim'='doris_groups',
    'oidc.allowed_algorithms'='RS256'
  );"
else
  doris_mysql -e "ALTER AUTHENTICATION INTEGRATION ${integration} SET PROPERTIES (
    'oidc.allowed_audiences'='${audience}'
  );"
fi

doris_mysql -e "DROP ROLE MAPPING IF EXISTS grafana_doris_sso_roles;
CREATE ROLE MAPPING grafana_doris_sso_roles ON AUTHENTICATION INTEGRATION ${integration}
RULE (USING CEL 'has_group(\"/doris-readers\")' GRANT ROLE doris_reader),
RULE (USING CEL 'has_group(\"/doris-writers\")' GRANT ROLE doris_writer);
ADMIN SET FRONTEND CONFIG ('authentication_chain' = '${integration}');"

echo "Configured local Doris SSO integration for ${audience}"
