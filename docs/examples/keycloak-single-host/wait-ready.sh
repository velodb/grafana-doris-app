#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
for attempt in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:${KEYCLOAK_PORT:-31880}/realms/master/.well-known/openid-configuration" >/dev/null 2>&1 &&
     curl -fsS "http://127.0.0.1:${GRAFANA_PORT:-31830}/api/health" >/dev/null 2>&1 &&
     docker compose exec -T doris test -f /opt/apache-doris/.ready >/dev/null 2>&1; then
    echo 'Keycloak, Grafana, Doris FE/BE are ready.'; exit 0
  fi
  if (( attempt % 6 == 0 )); then echo "Waiting for services (${attempt}/120)..."; fi
  sleep 5
done
docker compose ps
echo 'Startup failed: inspect docker compose logs --tail 100 SERVICE.' >&2
exit 1
