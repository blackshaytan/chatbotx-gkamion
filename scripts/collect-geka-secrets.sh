#!/usr/bin/env bash
# Copies Geka's live MAX / ZZAP / DROM settings into one project folder
# (.secrets/geka/, gitignored) for `pnpm geka:import`. Sources are only read.
#
# Usage: scripts/collect-geka-secrets.sh [--force]
#   --force   overwrite files that already exist in the destination
#
# Source overrides (env): GEKA_ENV_FILE, DASHBOARD_ENV_FILE, GEKA_DROM_COOKIES,
# GEKA_DROM_STATE; destination: GEKA_DEST. A missing source is a warning.
# Secrets are never printed: the summary shows masked values only.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
GEKA_ENV_FILE=${GEKA_ENV_FILE:-/GKamion/new-chat-bot/.env}
DASHBOARD_ENV_FILE=${DASHBOARD_ENV_FILE:-/GKamion/Dashboard/.env}
GEKA_DROM_COOKIES=${GEKA_DROM_COOKIES:-/GKamion/new-chat-bot/deploy/data/logs/drom-cookies.playwright.json}
GEKA_DROM_STATE=${GEKA_DROM_STATE:-/GKamion/new-chat-bot/deploy/data/logs/drom-spike/poll-state.json}
DEST=${GEKA_DEST:-$ROOT/.secrets/geka}
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h | --help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"

warn() { echo "warning: $*" >&2; }

# Last `KEY=value` (optionally `export KEY=`) of an env file, quotes stripped.
env_value() {
  local file=$1 key=$2 value
  value=$(awk -v key="$key" '
    match($0, "^[[:space:]]*(export[[:space:]]+)?" key "=") { v = substr($0, RLENGTH + 1) }
    END { print v }' "$file" | tr -d '\r')
  value=${value#\"}
  value=${value%\"}
  value=${value#\'}
  value=${value%\'}
  printf '%s' "$value"
}

mask() {
  local value=$1
  if [ -z "$value" ]; then
    echo "(empty)"
  elif [ "${#value}" -ge 20 ]; then
    echo "${value:0:4}…${value: -4} (${#value} chars)"
  else
    echo "•••• (${#value} chars)"
  fi
}

# write_file <name> <source-file>: copies through a temp file, mode 600.
write_file() {
  local name=$1 source=$2 target="$DEST/$1"
  if [ -e "$target" ] && [ "$FORCE" -ne 1 ]; then
    echo "  $name: kept (exists, use --force to overwrite)"
    rm -f "$source"
    return
  fi
  mv "$source" "$target"
  chmod 600 "$target"
  echo "  $name: written"
}

json_ok() { python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$1" 2>/dev/null; }

STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "Collecting Geka settings into $DEST"

# --- MAX ---------------------------------------------------------------
if [ -r "$GEKA_ENV_FILE" ]; then
  max_token=$(env_value "$GEKA_ENV_FILE" MAX_BOT_TOKEN)
  max_secret=$(env_value "$GEKA_ENV_FILE" MAX_WEBHOOK_SECRET)
  if [ -n "$max_token" ]; then
    tmp=$(mktemp "$DEST/.max.XXXXXX")
    {
      echo "# Collected from $GEKA_ENV_FILE at $STAMP"
      echo "MAX_BOT_TOKEN=$max_token"
      echo "MAX_WEBHOOK_SECRET=$max_secret"
    } >"$tmp"
    write_file max.env "$tmp"
    echo "    MAX_BOT_TOKEN=$(mask "$max_token")"
    echo "    MAX_WEBHOOK_SECRET=$(mask "$max_secret")"
  else
    warn "MAX_BOT_TOKEN is empty in $GEKA_ENV_FILE; max.env skipped"
  fi
else
  warn "Geka env $GEKA_ENV_FILE not readable; max.env skipped"
fi

# --- ZZAP --------------------------------------------------------------
if [ -r "$DASHBOARD_ENV_FILE" ]; then
  zzap_key=$(env_value "$DASHBOARD_ENV_FILE" ZZAP_API_KEY)
  if [ -n "$zzap_key" ]; then
    code_object=$(env_value "$DASHBOARD_ENV_FILE" ZZAP_CODE_OBJECT)
    type_object=$(env_value "$DASHBOARD_ENV_FILE" ZZAP_TYPE_OBJECT)
    test_mode=$(env_value "$DASHBOARD_ENV_FILE" ZZAP_TEST_MODE)
    tmp=$(mktemp "$DEST/.zzap.XXXXXX")
    {
      echo "# Collected from $DASHBOARD_ENV_FILE at $STAMP"
      echo "# CODE_OBJECT/TYPE_OBJECT/TEST_MODE default to the Dashboard's -1/0/false"
      echo "ZZAP_API_KEY=$zzap_key"
      echo "CODE_OBJECT=${code_object:--1}"
      echo "TYPE_OBJECT=${type_object:-0}"
      echo "TEST_MODE=${test_mode:-false}"
      echo "POLL_INTERVAL_SECONDS=$(env_value "$DASHBOARD_ENV_FILE" ZZAP_POLL_INTERVAL_SECONDS)"
      echo "MAX_THREADS_PER_POLL=$(env_value "$DASHBOARD_ENV_FILE" ZZAP_MAX_THREADS_PER_POLL)"
      echo "REQUEST_MIN_INTERVAL_SECONDS=$(env_value "$DASHBOARD_ENV_FILE" ZZAP_REQUEST_MIN_INTERVAL_SECONDS)"
    } >"$tmp"
    write_file zzap.env "$tmp"
    echo "    ZZAP_API_KEY=$(mask "$zzap_key")"
  else
    warn "ZZAP_API_KEY is empty in $DASHBOARD_ENV_FILE; zzap.env skipped"
  fi
else
  warn "Dashboard env $DASHBOARD_ENV_FILE not readable; zzap.env skipped"
fi

# --- DROM --------------------------------------------------------------
if [ -r "$GEKA_DROM_COOKIES" ] && json_ok "$GEKA_DROM_COOKIES"; then
  tmp=$(mktemp "$DEST/.drom-cookies.XXXXXX")
  cat "$GEKA_DROM_COOKIES" >"$tmp"
  write_file drom-cookies.json "$tmp"
  seller_login=${DROM_SELLER_LOGIN:-$(python3 -c '
import json, sys
data = json.load(open(sys.argv[1]))
items = data if isinstance(data, list) else data.get("cookies", [])
print(next((c.get("value", "") for c in items if c.get("name") == "login"), ""))
' "$GEKA_DROM_COOKIES")}
  poll_interval=""
  [ -r "$GEKA_ENV_FILE" ] && poll_interval=$(env_value "$GEKA_ENV_FILE" DROM_POLL_INTERVAL)
  tmp=$(mktemp "$DEST/.drom.XXXXXX")
  {
    echo "# Collected at $STAMP; DROM_SELLER_LOGIN comes from the 'login' cookie unless set"
    echo "DROM_SELLER_LOGIN=$seller_login"
    echo "DROM_POLL_INTERVAL=$poll_interval"
  } >"$tmp"
  write_file drom.env "$tmp"
  [ -n "$seller_login" ] || warn "no 'login' cookie found; set DROM_SELLER_LOGIN in drom.env"
else
  warn "DROM cookies $GEKA_DROM_COOKIES missing or not JSON; drom-cookies.json and drom.env skipped"
fi

if [ -r "$GEKA_DROM_STATE" ] && json_ok "$GEKA_DROM_STATE"; then
  tmp=$(mktemp "$DEST/.drom-state.XXXXXX")
  cat "$GEKA_DROM_STATE" >"$tmp"
  write_file drom-state.json "$tmp"
else
  warn "DROM state $GEKA_DROM_STATE missing or not JSON; drom-state.json skipped"
fi

# --- README (no values) ------------------------------------------------
tmp=$(mktemp "$DEST/.readme.XXXXXX")
cat >"$tmp" <<EOF
# Geka settings snapshot

Collected at $STAMP by scripts/collect-geka-secrets.sh. Do not commit.

| File | Source |
|------|--------|
| max.env | $GEKA_ENV_FILE |
| zzap.env | $DASHBOARD_ENV_FILE |
| drom.env | 'login' cookie of $GEKA_DROM_COOKIES, DROM_POLL_INTERVAL of $GEKA_ENV_FILE |
| drom-cookies.json | $GEKA_DROM_COOKIES |
| drom-state.json | $GEKA_DROM_STATE |

Import (dry run first): pnpm geka:import --workspace <id> [--apply]
EOF
write_file README.md "$tmp"
