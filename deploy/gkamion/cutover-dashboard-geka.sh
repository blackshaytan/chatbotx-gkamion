#!/usr/bin/env bash
# Readiness check for moving the operator inbox (dashboard.gkamion.ru)
# and the Geka chat bot off n8n/docker onto ChatbotX.
#
# Default is a dry run: it prints blockers and the exact stop list.
# It never stops containers and never deactivates workflows.
#
# What this cutover is:
#   dashboard  = operator inbox (telegram, max, zzap, drom, email)
#   Geka       = n8n workflows "Geka — *" that answer those chats
#
# What this cutover is not (left running):
#   n8n itself, geka-hooks (:5680 order/balance/invoice webhooks),
#   voice-ai, tmtr-runner, searxng, GKamion order/1C/warehouse/finance
#   workflows, and the ChatbotX stack.
#
# Switch order, once the blockers are gone, in one quiet minute:
#   1. Attach Hermes to the live inboxes (this does not move webhooks).
#   2. Re-import MAX/ZZAP/DROM so the cursor is fresh, then deactivate
#      the Geka workflows.
#   3. Resume MAX/ZZAP/DROM and connect @Gkamionbot. Connecting Telegram
#      moves its webhook off n8n immediately.
#   4. Stop dashboard-frontend-1 and dashboard-backend-1.
#      Leave dashboard postgres/redis and the nginx site in place.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
APPLY=0
if [ "${1:-}" = "--apply" ]; then
  APPLY=1
fi

PSQL=(docker exec chatbotx-postgres-1 psql -U chatbotx -d chatbotx -At -F '|')
N8N=(docker exec n8n-n8n-postgres-1 psql -U n8n -d n8n -At -F '|')

blockers=0
note() { printf '%s\n' "$1"; }
block() { blockers=$((blockers + 1)); printf 'BLOCKED  %s\n' "$1"; }
ok() { printf 'ready    %s\n' "$1"; }

note "ChatbotX channels (workspace GKamion)"
"${PSQL[@]}" -c "SELECT channel || '|' || status || '|' || COALESCE(\"statusReason\", '') || '|' || \"displayName\" || '|' || \"sourceId\" FROM \"Connection\" WHERE \"workspaceId\" = 11746094584081822 ORDER BY channel;" \
  | while IFS='|' read -r channel status reason name source; do
      printf '         %-10s %-12s %s (%s)\n' "$channel" "$status" "$name" "$source"
    done

prod_tg=$("${PSQL[@]}" -c "SELECT status FROM \"Connection\" WHERE provider = 'telegram' AND \"sourceId\" = '8662264397';")
if [ "$prod_tg" = "connected" ]; then
  ok "production Telegram @Gkamionbot is connected in ChatbotX"
else
  block "production Telegram @Gkamionbot (8662264397) is not in ChatbotX. The connected bot is gkamion_test_bot. Its webhook still points at n8n."
fi

for channel in max zzap drom; do
  status=$("${PSQL[@]}" -c "SELECT status FROM \"Connection\" WHERE channel = '${channel}' AND \"workspaceId\" = 11746094584081822;")
  if [ "$status" = "connected" ]; then
    ok "$channel is connected"
  else
    block "$channel is '${status:-missing}'. It was imported paused on purpose and still belongs to the dashboard/Geka."
  fi
done

email=$("${PSQL[@]}" -c "SELECT count(*) FROM \"Inbox\" WHERE channel IN ('email', 'smtp') AND \"workspaceId\" = 11746094584081822;")
if [ "${email:-0}" != "0" ]; then
  ok "email inbox exists"
else
  block "no email inbox in ChatbotX. The dashboard still holds 736 email conversations."
fi

agent_inboxes=$("${PSQL[@]}" -c "SELECT i.channel || ':' || COALESCE(c.\"sourceId\", '') FROM \"ExternalAgentInbox\" e JOIN \"Inbox\" i ON i.id = e.\"inboxId\" LEFT JOIN \"Connection\" c ON c.\"inboxId\" = i.id WHERE e.\"workspaceId\" = 11746094584081822 ORDER BY 1;")
note "Hermes is attached to: ${agent_inboxes//$'\n'/, }"
if printf '%s\n' "$agent_inboxes" | grep -qx 'telegram:8662264397'; then
  ok "Hermes answers @Gkamionbot"
else
  block "Hermes is not attached to @Gkamionbot. The telegram inbox it has is gkamion_test_bot."
fi
for channel in max zzap drom; do
  if printf '%s\n' "$agent_inboxes" | grep -q "^${channel}:"; then
    ok "Hermes answers $channel"
  else
    block "Hermes does not answer $channel."
  fi
done

note ""
note "Geka workflows that this cutover deactivates (chat only):"
"${N8N[@]}" -c "SELECT id || '  ' || name FROM workflow_entity WHERE active AND name LIKE 'Geka %' ORDER BY name;" \
  | sed 's/^/         /'

note ""
note "Left running: every other active n8n workflow (orders, voice, 1C, warehouse,"
note "finance, Novofon, TMTR), containers n8n-*, geka-hooks, voice-ai, deploy-tmtr-runner."
note "Dashboard stop list, and only after the blockers above are gone:"
note "         dashboard-frontend-1  dashboard-backend-1"
note "         postgres and redis of the dashboard stay up until the inbox is backed up."
note "         nginx site dashboard.gkamion.ru is not deleted."

note ""
if [ "$blockers" -gt 0 ]; then
  note "$blockers blocker(s). Not switching anything."
  if [ "$APPLY" -eq 1 ]; then
    note "--apply refused: ChatbotX cannot take the live chats yet."
    exit 2
  fi
  exit 0
fi

note "Ready."
if [ "$APPLY" -eq 0 ]; then
  note "Re-run with --apply only after a backup of the dashboard database and a quiet minute on the chats."
  exit 0
fi

if [ "${CUTOVER_CONFIRM:-}" != "dashboard-geka" ]; then
  note "Refusing --apply without CUTOVER_CONFIRM=dashboard-geka."
  exit 2
fi

note "Deactivating Geka chat workflows."
"${N8N[@]}" -c "UPDATE workflow_entity SET active = false WHERE active AND name LIKE 'Geka %';"
note "n8n keeps serving a workflow until its process reloads. Reload n8n only"
note "in a window you accept for the other workflows, then stop the dashboard UI:"
note "  docker stop dashboard-frontend-1 dashboard-backend-1"
exit 0
