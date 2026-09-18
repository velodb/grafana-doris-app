# Local Grafana + Doris test environment

This environment is isolated from the repository's existing development container. It starts:

-   Grafana at <http://localhost:3003> (`admin` / `admin`)
-   Doris HTTP at <http://localhost:18030>
-   Doris MySQL at `127.0.0.1:19030` (`root`, empty password)
-   Datasource JWKS endpoint at `127.0.0.1:8999/.well-known/jwks.json` once a signing key is configured
-   A provisioned `Doris Test` datasource and enabled `velodb-doris-app`
-   An `otel.otel_logs` table with recent `app1`, `app2`, and `app3` records

## Start

Build the plugin and start the environment from the repository root:

```bash
npm run build
docker compose -f test-env/docker-compose.yaml up -d --build
```

Open <http://localhost:3003/a/velodb-doris-app> and enter Discover. The default one-day time range should populate the Application dropdown with `app1`, `app2`, and `app3`.

Selecting an Application only changes the draft. Click **Query** or press Enter in the search box to apply it.

## Inspect test data

```bash
docker compose -f test-env/docker-compose.yaml exec doris \
  mysql -h127.0.0.1 -P9030 -uroot -e \
  "SELECT timestamp, service_name, resource_attributes['app'] AS app FROM otel.otel_logs ORDER BY timestamp DESC"
```

## Reset or stop

Re-run the one-shot seeder without deleting Doris volumes:

```bash
docker compose -f test-env/docker-compose.yaml run --rm doris-init
```

Stop containers while keeping Doris data:

```bash
docker compose -f test-env/docker-compose.yaml down
```

Remove the environment and all test data:

```bash
docker compose -f test-env/docker-compose.yaml down -v
```

Ports and Grafana credentials can be overridden with `GRAFANA_PORT`, `DORIS_HTTP_PORT`, `DORIS_MYSQL_PORT`, `DORIS_SSO_JWKS_PORT`, `GRAFANA_ADMIN_USER`, and `GRAFANA_ADMIN_PASSWORD`.

## Test with a standard OIDC provider (Keycloak)

Keycloak is provided as an isolated standard-OIDC test IDP. It imports the `velodb` realm and exposes its Discovery document at <http://localhost:8085/realms/velodb/.well-known/openid-configuration>.

```bash
docker compose --env-file test-env/keycloak.env -f test-env/keycloak-compose.yaml up -d
IDP_ENV_FILE=./keycloak.env docker compose -f test-env/docker-compose.yaml up -d --force-recreate grafana
```

The Compose environment mounts the ignored local signing key into Grafana and configures the deployment-level Doris SSO Profile automatically. It also configures the local Doris authentication integration with the provisioned datasource audience `velodb-doris:velodb-doris-sso`. Configure the datasource with `OIDC Discovery`, issuer `http://localhost:8085/realms/velodb`, and audience `grafana-keycloak-local`. The local datasource provisioning supplies the internal OIDC backchannel URL for Docker. The local Keycloak credentials are in ignored `test-env/keycloak.env`; do not reuse them outside this development environment.

The imported client emits a full-path `groups` claim in the ID Token. Configure the Datasource mappings `/doris-readers` → `doris_reader` and `/doris-writers` → `doris_writer`, then execute the generated Bootstrap SQL (or use the supplied local role mapping). The realm provides `doris.keycloak.tester`, `doris.keycloak.writer`, and `doris.keycloak.multi`; all use the local test password. Groups are forwarded unchanged to Doris, and a user without a matching Doris role mapping receives no implicit default role. See [OIDC user acceptance and test guide](../docs/oidc-user-test-zh.md).
