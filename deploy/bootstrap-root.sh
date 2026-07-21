#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  printf 'Run this script through sudo.\n' >&2
  exit 1
fi

if [[ -z "${CERTBOT_EMAIL:-}" || "$CERTBOT_EMAIL" != *@*.* ]]; then
  printf 'Set CERTBOT_EMAIL to an operational email address.\n' >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_IP="47.237.77.35"
DEPLOY_USER="zkm"
DEPLOY_GROUP="labadmins"
APP_ROOT="/var/www/last-mile-studio"
ACME_ROOT="/var/www/letsencrypt"
NGINX_SERVER_CONFIG="/etc/nginx/conf.d/flask_app.conf"
NGINX_SNIPPET_DIR="/etc/nginx/snippets"
HTTP_SNIPPET="$NGINX_SNIPPET_DIR/last-mile-studio-http.conf"
SECURITY_SNIPPET="$NGINX_SNIPPET_DIR/last-mile-studio-security-headers.conf"
HTTPS_CONFIG="/etc/nginx/conf.d/last-mile-studio-https.conf"
CERTBOT_ROOT="/opt/certbot"
CERTBOT_VERSION="5.4.0"
PATCH_PYTHON="/usr/bin/python3"
CERTBOT_PYTHON="/opt/miniconda3/bin/python3"
BACKUP_DIR="$STAGING_ROOT/bootstrap-backups/$(date -u +%Y%m%dT%H%M%SZ)"

wait_for_http_status() {
  local url="$1"
  local expected_status="$2"
  local host_header="$3"
  local status=""
  local attempt

  for attempt in {1..50}; do
    status="$(curl \
      --silent \
      --output /dev/null \
      --write-out '%{http_code}' \
      --header "Host: $host_header" \
      "$url" || true)"
    if [[ "$status" == "$expected_status" ]]; then
      return 0
    fi
    sleep 0.2
  done

  printf 'Timed out waiting for %s to return %s; last status was %s.\n' \
    "$url" "$expected_status" "${status:-<empty>}" >&2
  curl \
    --silent \
    --show-error \
    --dump-header - \
    --output /dev/null \
    --header "Host: $host_header" \
    "$url" >&2 || true
  tail -n 50 /var/log/nginx/modelselect-error.log >&2 || true
  return 1
}

wait_for_https_status() {
  local url="$1"
  local expected_status="$2"
  local status=""
  local attempt

  for attempt in {1..50}; do
    status="$(curl \
      --silent \
      --output /dev/null \
      --write-out '%{http_code}' \
      --resolve "$SERVER_IP:443:127.0.0.1" \
      "$url" || true)"
    if [[ "$status" == "$expected_status" ]]; then
      return 0
    fi
    sleep 0.2
  done

  printf 'Timed out waiting for %s to return %s; last status was %s.\n' \
    "$url" "$expected_status" "${status:-<empty>}" >&2
  curl \
    --silent \
    --show-error \
    --dump-header - \
    --output /dev/null \
    --resolve "$SERVER_IP:443:127.0.0.1" \
    "$url" >&2 || true
  tail -n 50 /var/log/nginx/last-mile-studio-error.log >&2 || true
  return 1
}

for command in nginx systemctl runuser openssl curl install sha256sum tar; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command" >&2
    exit 1
  fi
done

if [[ ! -x "$PATCH_PYTHON" || ! -x "$CERTBOT_PYTHON" ]]; then
  printf 'Required Python interpreter is missing: %s or %s\n' "$PATCH_PYTHON" "$CERTBOT_PYTHON" >&2
  exit 1
fi

if ! "$CERTBOT_PYTHON" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'; then
  printf 'Certbot requires Python 3.10 or newer: %s\n' "$CERTBOT_PYTHON" >&2
  exit 1
fi

install -d -m 0750 "$BACKUP_DIR"
cp -a "$NGINX_SERVER_CONFIG" "$BACKUP_DIR/flask_app.conf"

backup_optional() {
  local path="$1"
  local name="$2"
  if [[ -e "$path" ]]; then
    cp -a "$path" "$BACKUP_DIR/$name"
    printf 'present\n' > "$BACKUP_DIR/$name.present"
  fi
}

backup_optional "$HTTP_SNIPPET" "last-mile-studio-http.conf"
backup_optional "$SECURITY_SNIPPET" "last-mile-studio-security-headers.conf"
backup_optional "$HTTPS_CONFIG" "last-mile-studio-https.conf"

restore_optional() {
  local path="$1"
  local name="$2"
  if [[ -f "$BACKUP_DIR/$name.present" ]]; then
    cp -a "$BACKUP_DIR/$name" "$path"
  else
    rm -f "$path"
  fi
}

rollback_on_error() {
  local exit_code="$?"
  trap - ERR
  printf 'Bootstrap failed; restoring the prior Nginx configuration from %s\n' "$BACKUP_DIR" >&2
  cp -a "$BACKUP_DIR/flask_app.conf" "$NGINX_SERVER_CONFIG"
  restore_optional "$HTTP_SNIPPET" "last-mile-studio-http.conf"
  restore_optional "$SECURITY_SNIPPET" "last-mile-studio-security-headers.conf"
  restore_optional "$HTTPS_CONFIG" "last-mile-studio-https.conf"
  if nginx -t; then
    systemctl reload nginx.service
  fi
  chown -R "$DEPLOY_USER:$DEPLOY_GROUP" "$BACKUP_DIR"
  exit "$exit_code"
}
trap rollback_on_error ERR

install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0755 "$APP_ROOT"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0755 "$APP_ROOT/releases"
install -d -o root -g root -m 0755 "$ACME_ROOT/.well-known/acme-challenge"
install -d -o root -g root -m 0755 "$NGINX_SNIPPET_DIR"

runuser -u "$DEPLOY_USER" -- "$SCRIPT_DIR/activate-release.sh" "$STAGING_ROOT"
runuser -u nginx -- test -r "$APP_ROOT/current/last-mile-studio/index.html"

install -o root -g root -m 0644 \
  "$SCRIPT_DIR/nginx/last-mile-studio-security-headers.conf" \
  "$SECURITY_SNIPPET"
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/nginx/last-mile-studio-http-bootstrap.conf" \
  "$HTTP_SNIPPET"

PATCH_RESULT_FILE="$BACKUP_DIR/nginx-patch-result.txt"
"$PATCH_PYTHON" "$SCRIPT_DIR/patch-nginx.py" "$NGINX_SERVER_CONFIG" "$HTTP_SNIPPET" > "$PATCH_RESULT_FILE"
PATCH_RESULT="$(<"$PATCH_RESULT_FILE")"
printf 'Nginx route patch: %s\n' "$PATCH_RESULT"

nginx -t
systemctl reload nginx.service
wait_for_http_status \
  "http://127.0.0.1/AfterPrompt/index.html" \
  "200" \
  "$SERVER_IP"
wait_for_http_status \
  "http://127.0.0.1/AfterPrompt/" \
  "200" \
  "$SERVER_IP"

if [[ -x "$CERTBOT_ROOT/bin/certbot" ]]; then
  INSTALLED_CERTBOT_VERSION="$($CERTBOT_ROOT/bin/certbot --version | awk '{print $2}')"
  if [[ "$INSTALLED_CERTBOT_VERSION" != "$CERTBOT_VERSION" ]]; then
    printf 'Existing %s has Certbot %s; expected %s. Refusing to overwrite it.\n' \
      "$CERTBOT_ROOT" "$INSTALLED_CERTBOT_VERSION" "$CERTBOT_VERSION" >&2
    exit 1
  fi
elif [[ -e "$CERTBOT_ROOT" ]]; then
  printf '%s exists but is not a valid Certbot environment.\n' "$CERTBOT_ROOT" >&2
  exit 1
else
  "$CERTBOT_PYTHON" -m venv "$CERTBOT_ROOT"
  PIP_DISABLE_PIP_VERSION_CHECK=1 \
    "$CERTBOT_ROOT/bin/pip" install --no-cache-dir "certbot==$CERTBOT_VERSION"
  "$CERTBOT_ROOT/bin/pip" freeze > "$CERTBOT_ROOT/requirements.lock"
fi

install -d -o root -g root -m 0755 /etc/letsencrypt/renewal-hooks/deploy
install -o root -g root -m 0755 \
  "$SCRIPT_DIR/certbot/reload-nginx.sh" \
  /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

if [[ ! -f "/etc/letsencrypt/live/$SERVER_IP/fullchain.pem" ]]; then
  "$CERTBOT_ROOT/bin/certbot" certonly \
    --non-interactive \
    --agree-tos \
    --email "$CERTBOT_EMAIL" \
    --preferred-profile shortlived \
    --webroot \
    --webroot-path "$ACME_ROOT" \
    --ip-address "$SERVER_IP" \
    --cert-name "$SERVER_IP"
fi

openssl x509 \
  -in "/etc/letsencrypt/live/$SERVER_IP/fullchain.pem" \
  -noout \
  -checkend 86400

"$CERTBOT_ROOT/bin/certbot" renew --dry-run

install -o root -g root -m 0644 \
  "$SCRIPT_DIR/nginx/last-mile-studio-https.conf" \
  "$HTTPS_CONFIG"
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/nginx/last-mile-studio-http-redirect.conf" \
  "$HTTP_SNIPPET"
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/systemd/last-mile-studio-certbot-renew.service" \
  /etc/systemd/system/last-mile-studio-certbot-renew.service
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/systemd/last-mile-studio-certbot-renew.timer" \
  /etc/systemd/system/last-mile-studio-certbot-renew.timer

if systemctl is-active --quiet firewalld.service; then
  firewall-cmd --permanent --add-service=https
  firewall-cmd --add-service=https
fi

nginx -t
systemctl reload nginx.service
systemctl daemon-reload
systemctl enable --now last-mile-studio-certbot-renew.timer

wait_for_https_status \
  "https://$SERVER_IP/AfterPrompt/healthz" \
  "200"

ROUTE_AFTER="$STAGING_ROOT/route-after-bootstrap.txt"
for path in / /espur/ /modelselect/ /healthz; do
  curl -sS -o /dev/null \
    -w "$path %{http_code} %{content_type} %{redirect_url}\n" \
    "http://127.0.0.1$path"
done > "$ROUTE_AFTER"

if [[ -f "$STAGING_ROOT/route-baseline.txt" ]]; then
  diff -u "$STAGING_ROOT/route-baseline.txt" "$ROUTE_AFTER"
fi

chown -R "$DEPLOY_USER:$DEPLOY_GROUP" "$BACKUP_DIR" "$ROUTE_AFTER"
trap - ERR

printf 'AfterPrompt bootstrap completed.\n'
printf 'Endpoint: https://%s/AfterPrompt/\n' "$SERVER_IP"
printf 'Nginx backup directory: %s\n' "$BACKUP_DIR"
printf 'Certificate timer: last-mile-studio-certbot-renew.timer\n'
