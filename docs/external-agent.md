# External AI agent (Hermes)

An external AI agent answers client messages in ChatbotX conversations. ChatbotX forwards the client's messages to a Hermes Agent `api_server` run, relays the agent's interim and final replies to the client, and hands the conversation to a human manager when the agent asks for it or fails. ChatbotX owns the channels, the inbox, the operators and the handover; Hermes owns the reasoning, its instructions and its memory.

- Builder: **Settings → Integrations → External AI agent** (`/space/{workspaceId}/settings/integrations/external-agent`). The page requires the `superAdmin` workspace permission, which the owner always has.
- Public API: `externalAgent.get`, `externalAgent.update`, `externalAgent.test` (scope `settings`) and `externalAgent.handover` (scope `inbox`). See [Public API, CLI and MCP](#public-api-cli-and-mcp).
- Code: `packages/business/src/external-agent/` (service, Hermes HTTP client, SSE parser, pure decision functions), `apps/worker/src/ai-agent/handlers/external-agent-{reply,watch,shared}.ts`, `apps/worker/src/integration/external-agent-inbox.ts` and the routing in `apps/worker/src/integration/routing.ts`, `packages/database/src/{schema,repositories}/external-agent*`, `packages/worker-config/src/queues/ai-agent/index.ts`, `apps/builder/src/features/external-agent/`.
- Design record: `docs/superpowers/specs/2026-10-21-hermes-external-agent-design.md`. Where the code and that spec differ, this document describes the code; the differences are listed in [Known differences from the design](#known-differences-from-the-design).

The agent answers only while the bot is on in a conversation. A paused conversation (a manager is handling it) is never answered by the agent.

## Data model

Three tables, all scoped by `workspaceId`:

| Table | One row per | Holds |
|---|---|---|
| `ExternalAgent` | workspace | `provider` (`hermes`), `baseUrl`, `apiKey` (encrypted, never returned), `enabled`, `resumeAfterHours` (null = never), `maxRunMinutes` (default 30, 1–240), `progressMessage` (default «Работаю над вашим запросом, это займёт несколько минут»; empty = off, up to 500 characters), last connection check |
| `ExternalAgentInbox` | (agent, inbox) pair | Which channels the agent answers in. No rows = the agent answers nowhere. |
| `ExternalAgentConversationState` | conversation | The cursor and the current run: `cursorAt` / `cursorMessageId`, `includeHistory`, `runId`, `runStartedAt`, `lastEventAt`, `lastEventSeq`, progress bookkeeping (`lastProgressSentAt`, `lastProgressText`, `lastClientSendAt`, `progressFallbackSentAt`), `failureCount`, `lastError`. Deleted with its conversation. |

The API key is stored encrypted with AES-GCM (`@chatbotx.io/encryption`), bound to the workspace. The settings read model exposes only `hasApiKey`.

## Flow

1. **Message arrives.** The inbound handler saves the client's message. If the message has text, an attachment or a location, the conversation's bot is on, and the inbox is one of the agent's enabled inboxes, the routing decision is `externalAgent` (`apps/worker/src/integration/routing.ts`). The check is `isExternalAgentInbox` → `externalAgentService.getRuntime`, which needs `enabled = true` and the inbox in `ExternalAgentInbox`.
2. **Debounced reply job.** `externalAgentReply` is queued on the `aiAgent` queue with a 5 s delay and a per-conversation deduplication id (`externalAgentReply-<conversationId>`, `replace` + `keepLastIfActive`). Several quick messages make one job, and the latest message wins.
3. **Reply job** (under `withBlockedOwnerGuard` and a Redis lock on the conversation):
   1. Loads the conversation and re-checks that the bot is on (`ensureActive`, which may auto-resume it, see below) and that the agent is enabled for the inbox. If not, it exits quietly.
   2. Selects the client messages after the cursor. None → exits.
   3. If the conversation already has a run (`runId` set), the new messages are sent into it with `steer`. The cursor moves forward when Hermes accepts. A 409 means the run is finishing: the job is re-queued (5 s debounce) and the messages go to the next run.
   4. Otherwise it starts a run: `POST {baseUrl}/v1/runs` with `Authorization: Bearer <key>`, `X-Hermes-Session-Key: chatbotx:<workspaceId>:<conversationId>` (Hermes keeps one memory session per conversation) and `Idempotency-Key: <conversationId>:<messageId>`. The run input is the new client messages (photos and files as signed links valid for 24 h, with their type), plus a context block marked as ChatbotX data: client name, channel, `conversationId`, `contactId`, `workspaceId`. The payload is cached per idempotency key, so a retry sends the same body.
   5. Saves `runId` and `runStartedAt`, moves the cursor, and queues `externalAgentWatch` for the conversation.
4. **Watch job** (`externalAgentWatch`, one chain per run). Every run is followed in windows of 15 s: it reads `GET {baseUrl}/v1/runs/{runId}/events?last_seq=<lastEventSeq>` and writes `lastEventSeq` / `lastEventAt` for each event. When the window ends without a final event, the job re-queues itself immediately; if the stream closed early, it re-queues after 5 s. The window is kept below BullMQ's 30 s job lock.
5. **Events:**
   - `message.interim` → a short progress message to the client, subject to the rules in [Long tasks](#long-tasks).
   - `tool.started`, `tool.completed`, `message.delta` → no client message; they only refresh the stall timer.
   - `run.completed` → the final text (or, if the event has no text, the run's `output` from `GET /v1/runs/{runId}`) goes to the client. The run closes, `failureCount` resets. If client messages arrived during the run and were not steered in, a new reply job is queued.
   - `run.failed`, `run.cancelled`, `run.interrupted`, or a tool approval request (`approval.request` / status `waiting_for_approval`) → the run is stopped if needed and treated as a failure (see [Failures](#failures)).
   - When the stream ends without a terminal event, the run status decides (`completed`, a failed status, or an approval wait); a run that Hermes no longer knows (404) is treated as ended.
   - If the bot was turned off, or the agent or inbox was removed, the watch closes the run and does not send anything (see [Disabling](#disabling)).

Final and interim sends carry deterministic job ids (`externalAgentSend-<conversation>-<run>-<step>`), so a re-run of a watch step does not send the same text twice.

## Cursor and history

- **First turn** (no cursor yet): the agent receives the client messages after the last outgoing message, at most 10, plus up to 10 earlier messages as history.
- **Later turns:** the agent receives only client messages after the cursor. Earlier messages are not resent. The Hermes session keeps its own memory of what it said.
- **Resume resets the cursor** (`enableBotState`, from «Return to bot», a manager action, or an automatic resume): the cursor moves to the resume time, `runId` is cleared, `failureCount` and `lastError` reset, and `includeHistory` is set again. Client messages written while a human owned the conversation are not replayed to Hermes. The first run after a resume gets the last 10 messages of the conversation (client and manager) as history.
- **Auto-resume trigger:** when the conversation resumes automatically because the client wrote after `botResumeAt`, the triggering message is included even though it was saved before the reset (a 60 s grace window).
- **Auto-resume is lazy:** `botResumeAt` is checked when the next client message arrives. There is no timer that turns the bot back on.

## Long tasks

Hermes can take minutes on a task (a price estimate, a VIN lookup). The client is kept informed as follows:

- **Interim messages from the agent** (`message.interim`) are sent to the client only if the bot is on, the text is not empty, it differs from the last interim text (case-insensitive), and at least 30 s have passed since the last interim message. Otherwise they are dropped.
- **Fallback message:** if `progressMessage` is not empty and 90 s have passed since the later of the run start and the last message sent to the client, the fallback is sent once per run (`progressFallbackSentAt`). The check runs once per 15 s window, so it can arrive a few seconds late.
- **Empty `progressMessage` turns the fallback off.** Interim messages from Hermes are unaffected.
- **Stall:** no event from Hermes for 5 minutes (from the last event, or from the run start) → the run is stopped and treated as a timeout.
- **Run limit:** once the run is older than `maxRunMinutes` (default 30) it is stopped and treated as a timeout, even while events keep arriving. Inside that limit, a long run with a steady stream of events is not a failure.

## Handover and return

**Who hands over:**

- **The agent**, by calling `externalAgent.handover` through the ChatbotX MCP server with a reason. It is in the default MCP tool set (`external_agent_handover`), so the agent calls it directly instead of through `search_tools`/`call_tool`. The reason is saved as a system note in the conversation timeline (the manager sees «The AI agent handed the conversation over to a manager: <reason>»), and the bot is turned off. The run is then stopped, so the agent's own reply never reaches the client; instead ChatbotX sends the client «Передал ваш запрос менеджеру» once, on the call that turns the bot off (a repeat call sends nothing).
- **A manager's reply** in the conversation turns the bot off, as before.
- **The platform** on failure (see below), with a note saying the agent was unavailable or timed out.

Every pause goes through `conversationService.updateBotEnabled`, which picks the resume time:

- For a conversation reachable through an enabled agent inbox: `resumeAfterHours` (null = `botResumeAt` null, only the button), or `now + N hours`.
- Otherwise: 24 hours, as before.

A paused conversation does not receive agent replies, and interim or final text from a run that is still going is not sent once the bot is off. The run is stopped by the next watch window (at most about 15 s later).

**Return:** the «Return to bot» button (the existing enable-bot action) turns the bot on, resets the cursor as described above, and the next client message starts a fresh run.

## Failures

| Situation | What happens |
|---|---|
| `POST /v1/runs` fails with 5xx, a timeout or a network error | Retried by BullMQ: 4 attempts in total, with exponential backoff of 30 s, 1 min, 2 min. `Idempotency-Key` makes a retry safe if Hermes did start the run. After the last attempt → handover. |
| Event stream read fails with 5xx or a network error | The watch job runs up to 3 attempts in total (retries after 10 s and 20 s), resuming from `lastEventSeq`. After the last attempt → handover. |
| Hermes 401 or 403 | No retry. Handover, error log entry, the job fails as unrecoverable. |
| Any other 4xx from Hermes | No retry. Handover, error log entry. |
| `run.failed`, `run.cancelled`, `run.interrupted`, tool approval request | Handover, error log entry. |
| No event for 5 minutes, or the run exceeded `maxRunMinutes` | Run stopped (`stop` sent to Hermes), handover with a timeout note, error log entry. |
| Client messages arrive while the agent is thinking | No second run is started. Messages go into the running run with `steer`; if it no longer accepts them, they are answered by the next run. |
| The channel delivers the same message twice | The message is saved once (existing deduplication) and the cursor prevents a second answer. |
| Hermes returns an empty reply | Nothing is sent; the cursor still moves. |
| The send to the channel fails | Existing ChatbotX send-error handling. |
| Owner blocked or trial expired | `withBlockedOwnerGuard` / `canAutomate`: the agent stays silent. |

**What the handover does (failure path):**

1. If the bot is on, the client receives «Передал ваш запрос менеджеру» (the text is fixed in Russian for every workspace, see [Known differences](#known-differences-from-the-design)). If the bot was already off, the client receives nothing.
2. The bot is turned off with the failure trigger (resume time from the same policy as above).
3. A note is written to the timeline: «The AI agent is unavailable, the conversation was handed over to a manager» or «The AI agent did not finish in time, the conversation was handed over to a manager». The manager sees these as translated dividers. Repeated notes within the same minute are not duplicated.
4. The failure is written to the error log with provider `hermes` (`logProviderError`), and `failureCount` / `lastError` are saved on the conversation state.

The client never sees technical details.

## Keywords and built-in AI

For a conversation in an agent inbox while the bot is on, the incoming-message routing picks the agent route instead of the automated-response route. Keyword replies and AI auto-replies, which run on that route, are therefore skipped for those messages. When the bot is off, the existing handoff re-entry route handles text as before.

This routing decides only the automated-response route. Other automations that react to a message are not suppressed by it; check them per workspace if they must stay silent for agent inboxes.

## Hermes side configuration

These steps are done on the Hermes host, not in this repository. They come from the design record (section 9) and were not verified by the code. The ChatbotX side only needs the base URL and the key.

- **`api_server`** in the `assistant` profile (`/opt/hermes-data/profiles/assistant/config.yaml`): `enabled: true`, `extra.host: 127.0.0.1`, a free port (the design uses 8647), and `extra.key` set to a new key. The key lives in Hermes' secrets and in ChatbotX's encrypted settings; never print it.
- **Toolsets** for `api_server`: `gkamion`, `memory`, `chatbotx`. No `terminal`.
- **MCP server `chatbotx`** with its own workspace token. Give it only the scopes it needs: `inbox` for `externalAgent.handover`, plus the inbox and contact scopes that Hermes needs to read context. It must not carry `settings`, and it cannot create tokens (invariant 23).
- **Instructions (`SOUL.md` or a profile skill):** reply to the client in text; for work longer than about 30 s, say first what is happening and roughly how long it takes; on long tasks report progress now and then (these become the interim messages); when a manager is needed, call the handover tool with a short reason and tell the client a manager will join.
- The ChatbotX worker runs with host networking (`deploy/gkamion/docker-compose.prod.yml`), so `http://127.0.0.1:<port>` is reachable from it. Restart the profile service after the change (a short Telegram outage); do this only with the owner's approval.
- Check that the port listens only on loopback (`ss -ltnp`).

## Settings and connection check

- **Hermes address** is the origin of the `api_server`, for example `http://127.0.0.1:8647`, with no path. ChatbotX appends `/v1/runs`, `/v1/runs/{id}/events` and `/health`. An address ending in `/v1` produces `/v1/v1/...` and fails. Credentials in the URL and non-http(s) schemes are rejected.
- **API key** is write-only. Leave it empty to keep the stored key.
- **Channels** are opt-in: by default the agent answers nowhere.
- **Test connection** calls `GET {baseUrl}/health` with the key, stores the result (`lastCheckStatus`, `lastCheckedAt`, `lastCheckError`) and is throttled to one check per 10 s (HTTP 429 when repeated).

## Public API, CLI and MCP

| Operation | HTTP | Scope | CLI | Notes |
|---|---|---|---|---|
| `externalAgent.get` | `GET /v1/external-agent` | `settings` | `chatbotx external-agent list` | Returns the settings object, or `null` until configured. The CLI name is derived as `list` because the route is not a singleton; the response is one object. |
| `externalAgent.update` | `PATCH /v1/external-agent` | `settings` | `chatbotx external-agent update --enabled --baseUrl --apiKey --inboxIds --resumeAfterHours --maxRunMinutes --progressMessage` | Only the fields you send change. `inboxIds` is a JSON array of ids from `inboxes.list`; `[]` stops every channel. `resumeAfterHours: null` turns automatic resume off. |
| `externalAgent.test` | `POST /v1/external-agent/test` | `settings` | `chatbotx external-agent test` | Returns `status`, `error`, `checkedAt`. |
| `externalAgent.handover` | `POST /v1/conversations/{conversationId}/external-agent-handover` | `inbox` | `chatbotx conversations external-agent-handover add <conversationId> --reason "<text>"` | Pauses the bot and writes the reason as a note. Conversation ids come from `conversations.list` or from the run context. |

- MCP tools: `external_agent_get`, `external_agent_update`, `external_agent_test`, `external_agent_handover`. None is in the default MCP set; agents reach them through `search_tools` / `call_tool`.
- The white-label test (`apps/builder/__tests__/public-spec-operations.test.ts`) forbids the product name in operation and schema `summary` / `description` copy. The new copy avoids it; keep that in mind when editing these descriptions.
- The CLI command reference for these operations is in `apps/cli/README.md` (section `external-agent`, and the handover command under `conversations`).

## Disabling

- **Turn the agent off:** set `enabled` to false in the settings or with `externalAgent.update`. Nothing is answered afterwards. Conversations already paused keep their bot state.
- **Stop one channel:** remove it from the list (or `inboxIds: []` for all).
- **Runs in progress:** when the agent is disabled, the watch job forgets the run without calling `stop` on Hermes (the agent's client is not available when it is disabled). The Hermes run may finish, and its output is dropped. When only the inbox is removed, the run is stopped.
- The Hermes profile can be disabled on its own in Hermes (`api_server` off). ChatbotX then gets 5xx or network errors, and failed conversations are handed over to managers.

## Known differences from the design

These are the places where the code differs from `docs/superpowers/specs/2026-10-21-hermes-external-agent-design.md`. The code is the reference in this document.

| Topic | Design says | Code does |
|---|---|---|
| Base URL | `http://127.0.0.1:8647/v1`, paths `{baseUrl}/runs` | Origin only (`http://127.0.0.1:8647`); paths include `/v1` |
| Handover | Hermes calls `conversations.update` with `botEnabled: false` | Hermes calls the dedicated `externalAgent.handover` operation |
| Retry backoff for `POST /runs` | 30 s, 2 min, 5 min | 30 s, 1 min, 2 min (exponential, 4 attempts in total) |
| 401 / 403 | Also sets `lastCheckStatus = error` | Hands over and logs the error; the stored check status changes only through `externalAgent.test` |
| Fallback message | Once, if nothing was sent since the run started | Once, after 90 s without any message to the client during the run |
| Stopping a run on handover | `stop` is sent when the bot goes off | The next watch window stops it (at most about 15 s) |
| Events | `run.completed`, `run.failed`, `run.interrupted` | Also `run.cancelled` and tool approval requests, both treated as failures |
| Restart recovery | `GET /runs/{id}` before reconnecting | Status is read when the stream closes early or the run is missing; a plain job retry reconnects from `lastEventSeq` |
| Activity notes | Russian text | Stored in English; the manager sees translated dividers |
| Client handover text | Localised | Fixed in Russian «Передал ваш запрос менеджеру» for every workspace |
| Disable while a run is active | Run stopped | Stopped only when the inbox is removed; disabling the agent does not stop the Hermes run |

## Verification notes

- Unit and integration tests for this feature live in `packages/business/__tests__/external-agent/`, `apps/worker/__tests__/external-agent-*.test.ts` and `apps/builder/__tests__/external-agent-api.test.ts`. They run in CI, not on the VPS.
