#!/usr/bin/env bash
# Publishes ChatbotX at https://chatbotx.gkamion.ru through the host nginx.
# Only adds /etc/nginx/conf.d/chatbotx.gkamion.ru.conf; other sites are not
# touched. Every reload is preceded by `nginx -t`, and a failing config is
# rolled back. Run as root once the DNS A record points at this server.
#
#   1. HTTP-only server block (ACME webroot) -> reload
#   2. certbot certonly --webroot (skipped when the certificate exists)
#   3. full HTTPS config -> reload
set -euo pipefail

DOMAIN=chatbotx.gkamion.ru
HERE=$(cd "$(dirname "$0")" && pwd)
SOURCE="$HERE/nginx/$DOMAIN.conf"
TARGET="/etc/nginx/conf.d/$DOMAIN.conf"
WEBROOT=/var/www/acme-chatbotx
BACKUP=""

server_ip=$(curl -fsS -m 10 https://api.ipify.org)
dns_ip=$(getent ahostsv4 "$DOMAIN" | awk 'NR == 1 { print $1 }')
if [ "$dns_ip" != "$server_ip" ]; then
  echo "DNS: $DOMAIN -> '${dns_ip:-nothing}', this server is $server_ip. Add the A record first." >&2
  exit 1
fi

if [ -e "$TARGET" ]; then
  BACKUP="$TARGET.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "$TARGET" "$BACKUP"
fi

rollback() {
  if [ -n "$BACKUP" ]; then
    cp -p "$BACKUP" "$TARGET"
  else
    rm -f "$TARGET"
  fi
  nginx -t && systemctl reload nginx
}

install_conf() {
  cp "$1" "$TARGET"
  if ! nginx -t; then
    echo "nginx -t failed; rolling back $TARGET" >&2
    rollback
    exit 1
  fi
  systemctl reload nginx
}

mkdir -p "$WEBROOT"

if [ ! -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  http_only=$(mktemp)
  awk '/^server \{/ { n++ } n < 2' "$SOURCE" >"$http_only"
  install_conf "$http_only"
  rm -f "$http_only"
  # Renewals reload nginx through the existing /etc/letsencrypt/renewal-hooks/deploy/ hook.
  certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --non-interactive --keep-until-expiring
fi

install_conf "$SOURCE"
echo "https://$DOMAIN is served by nginx (backend 127.0.0.1:3123, realtime 127.0.0.1:1999)."
