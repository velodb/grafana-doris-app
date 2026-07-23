# Local Grafana + Doris test environment

This environment is isolated from the repository's existing development container. It starts:

- Grafana at <http://localhost:3003> (`admin` / `admin`)
- Doris HTTP at <http://localhost:18030>
- Doris MySQL at `127.0.0.1:19030` (`root`, empty password)
- A provisioned `Doris Test` datasource and enabled `velodb-doris-app`
- An `otel.otel_logs` table with recent `app1`, `app2`, and `app3` records

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

Ports and Grafana credentials can be overridden with `GRAFANA_PORT`, `DORIS_HTTP_PORT`, `DORIS_MYSQL_PORT`, `GRAFANA_ADMIN_USER`, and `GRAFANA_ADMIN_PASSWORD`.

