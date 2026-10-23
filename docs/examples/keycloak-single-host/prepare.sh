#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ $(id -u) == 0 ]] || { echo 'Run as root (sudo -i).'; exit 1; }
[[ -f .env ]] || { echo 'Copy .env.example to .env and keep PUBLIC_HOST=localhost.'; exit 1; }
set -a; source .env; set +a
[[ ${PUBLIC_HOST:-localhost} == localhost ]] || { echo 'This SSH-tunnel lab uses PUBLIC_HOST=localhost. Use the HTTPS appendix for other hostnames.'; exit 1; }
for key in KEYCLOAK_ADMIN_PASSWORD GRAFANA_ADMIN_PASSWORD TLS_STORE_PASSWORD; do
  if ! grep -q "^${key}=" .env; then printf '%s=%s\n' "$key" "$(openssl rand -hex 20)" >>.env; fi
done
chmod 600 .env
set -a; source .env; set +a
mkdir -p tls secrets
chmod 700 tls
# Existing files are retained; rerunning does not silently rotate the CA or signing key.
if [[ ! -f tls/ca.key ]]; then
  openssl req -x509 -newkey rsa:3072 -nodes -days 365 -keyout tls/ca.key -out tls/ca.crt -subj '/CN=Doris OIDC Lab CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign'
fi
if [[ ! -f tls/server.p12 ]]; then
  openssl req -newkey rsa:3072 -nodes -keyout tls/server.key -out tls/server.csr -subj '/CN=doris'
  printf 'subjectAltName=DNS:doris,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' >tls/server.ext
  openssl x509 -req -in tls/server.csr -CA tls/ca.crt -CAkey tls/ca.key -CAcreateserial -out tls/server.crt -days 365 -extfile tls/server.ext
  openssl pkcs12 -export -inkey tls/server.key -in tls/server.crt -certfile tls/ca.crt -out tls/server.p12 -passout env:TLS_STORE_PASSWORD
  openssl pkcs12 -export -inkey tls/ca.key -in tls/ca.crt -out tls/ca.p12 -passout env:TLS_STORE_PASSWORD
fi
if [[ ! -f secrets/doris-sso.pem ]]; then
  (umask 077; openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out secrets/doris-sso.pem)
fi
# Pinned Grafana image runs as UID 472; parent directory must be traversable.
chown 472:472 secrets/doris-sso.pem
chmod 400 secrets/doris-sso.pem
chmod 755 secrets
[[ -f fe-custom.conf ]] || printf '# Persistent OIDC chain is added by configure-doris.sh\n' >fe-custom.conf
[[ -x plugins/velodb-doris-app/datasource/velodb-doris-datasource_linux_amd64 ]] || { echo 'Missing Linux amd64 Grafana plugin; extract the companion package.'; exit 1; }
[[ -f enterprise-plugins/fe-authentication-plugin-oidc-1.0.0.jar && -f enterprise-plugins/lib/nimbus-jose-jwt-10.0.1.jar ]] || { echo 'Missing Doris OIDC plugin/dependency.'; exit 1; }
openssl verify -CAfile tls/ca.crt tls/server.crt
docker compose config --quiet
printf 'Prepared. Credentials are in .env; do not paste them into documentation.\n'
