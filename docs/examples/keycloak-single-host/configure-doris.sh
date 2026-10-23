#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
uid=$(cat datasource.uid)
[[ $uid =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Invalid datasource.uid'; exit 1; }
integration="grafana_doris_sso_${uid//-/_}"
# SQL is generated from the saved datasource UID, never copied from another environment.
cat > bootstrap.sql <<SQL
CREATE AUTHENTICATION INTEGRATION \`$integration\` PROPERTIES (
 'type'='oidc', 'enable_jit_user'='true',
 'oidc.issuer'='http://${PUBLIC_HOST:-localhost}:${JWKS_PORT:-31899}',
 'oidc.jwks_uri'='http://grafana:8999/.well-known/jwks.json',
 'oidc.allowed_audiences'='velodb-doris:$uid',
 'oidc.required_scopes'='doris.query',
 'oidc.username_claim'='username', 'oidc.subject_claim'='sub',
 'oidc.groups_claim'='doris_groups', 'oidc.allowed_algorithms'='RS256'
);
CREATE ROLE MAPPING \`${integration}_roles\` ON AUTHENTICATION INTEGRATION \`$integration\`
 RULE (USING CEL 'has_group("/reader")' GRANT ROLE doris_reader);
ADMIN SET FRONTEND CONFIG ('authentication_chain'='$integration');
SQL
count=$(docker compose exec -T doris mysql -h127.0.0.1 -P9030 -uroot -N -e "SELECT COUNT(*) FROM information_schema.authentication_integrations WHERE name='$integration'")
[[ $count == 0 ]] || { echo 'Integration already exists. Review bootstrap.sql; existing configuration was retained.'; exit 1; }
docker compose exec -T doris mysql -h127.0.0.1 -P9030 -uroot <bootstrap.sql
# Rewrite the existing bind-mounted file in place, so a restart sees the new content.
printf '# Single-integration isolated lab only\nauthentication_chain = %s\n' "$integration" >fe-custom.conf
docker compose exec -T doris mysql -h127.0.0.1 -P9030 -uroot -e "SHOW FRONTEND CONFIG LIKE 'authentication_chain';"
