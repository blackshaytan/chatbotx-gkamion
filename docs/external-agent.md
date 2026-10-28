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
| `ExternalAgent` | workspace | `provider` (`hermes`), `baseUrl`, `apiKey` (encrypted, never returned), `enabled`, `resumeAfterHours` (null = never; applies to manager pauses, not agent handovers), `maxRunMinutes` (default 30, 1–240), `progressMessage` (default «Работаю над вашим запросом, это займёт несколько минут»; empty = off, up to 500 characters), `botName` (agent name for the signature, up to 40 characters, null = no agent prefix), `signMessages` and `announceManager` (both default false; see [Manager join notice, signatures and message time](#manager-join-notice-signatures-and-message-time)), last connection check |
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
- **Resume resets the cursor** (`enableBotState`, from «Return to bot», a manager action, or an automatic resume): the cursor moves to the resume time, `runId` is cleared, `failureCount` and `lastError` reset, `includeHistory` is set again, and `handoverCategory` and `handedOverAt` are cleared. Client messages written while a human owned the conversation are not replayed to Hermes. The first run after a resume gets the last 10 messages of the conversation (client and manager) as history.
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

- **The agent**, by calling `externalAgent.handover` through the ChatbotX MCP server with a reason and a `category` (`urgent`, `return`, `payment`, `orderStatus`, `delivery`, `priceAndTerm` or `other`; default `other`). It is in the default MCP tool set (`external_agent_handover`), so the agent calls it directly instead of through `search_tools`/`call_tool`. The reason is saved as a system note in the conversation timeline (the manager sees «The AI agent handed the conversation over to a manager · <category>: <reason>»). The category and the handover time are stored on the conversation, and the bot is turned off with `botResumeAt` null, so the conversation does not resume on its own. The run is then stopped, so the agent's own reply never reaches the client; instead ChatbotX sends the client a time-aware confirmation once, on the call that turns the bot off (a repeat call sends nothing): «Я передала ваш запрос менеджеру» during pickup-point working hours, or «Сейчас нерабочее время пункта выдачи. График по Москве: Пн–Пт 10:00–19:00, Сб 12:00–16:00, Вс — выходной. Я уже передала ваш запрос менеджеру. Менеджер ответит вам в рабочее время.» outside them (Moscow time: Mon–Fri 10:00–19:00, Sat 12:00–16:00, Sun closed). That first call also sends the managers one push (see [Inbox and notifications](#inbox-and-notifications)).
- **A manager's reply** in the conversation turns the bot off, as before.
- **The platform** on failure (see below), with a note saying the agent was unavailable or timed out.

Every pause goes through `conversationService.updateBotEnabled`, which picks the resume time:

- For a conversation reachable through an enabled agent inbox: `resumeAfterHours` (null = `botResumeAt` null, only the button), or `now + N hours`.
- Otherwise: 24 hours, as before.

An agent handover is the exception: it always passes `noAutoResume`, so the resume time is null whatever `resumeAfterHours` says, and the conversation stays with managers until someone presses «Return to bot». `resumeAfterHours` applies only to pauses that a manager starts by writing in the conversation.

A paused conversation does not receive agent replies, and interim or final text from a run that is still going is not sent once the bot is off. The run is stopped by the next watch window (at most about 15 s later).

**Return:** the «Return to bot» button (Вернуть боту in Russian; the existing enable-bot action) turns the bot on, resets the cursor as described above, clears the handover category, the handover time and the join-notice time (see [Manager join notice, signatures and message time](#manager-join-notice-signatures-and-message-time)), and the next client message starts a fresh run.

## Manager join notice, signatures and message time

Three settings on `ExternalAgent` control what the client sees once a manager takes over. They apply only to inboxes the agent answers in (the agent is enabled and the inbox is in `ExternalAgentInbox`). Other inboxes and flow-only bots behave as before.

- **`botName`**: the agent's name, used in the signature. Up to 40 characters; an empty value or null clears it. Without a name, agent replies get no prefix.
- **`signMessages`** (default off): prefix replies with the sender's name.
- **`announceManager`** (default off): send the client the join notice.

They are in **Settings → Integrations → External AI agent** (the «Bot name», «Sign replies with the sender's name» and «Announce the manager after a handover» fields) and in `externalAgent.update`.

### Join notice

After a handover, the client gets «Вам отвечает менеджер {имя}», or «Вам отвечает менеджер» when the manager has no name in the profile. The name is the manager's `User.name`. The text is fixed in Russian for every workspace, like the handover text.

The notice is sent at most once per handover:

- **When it is sent.** Whichever comes first after an agent handover:
  - The conversation is assigned to a user, from the UI or through `conversations.assign`. Assigning to a team does not send it.
  - A manager sends the first reply from ChatbotX. A public comment reply does not count. When this reply is the one that sends the notice, the reply job is delayed by 2 seconds so the notice reaches the client first.
- **Conditions.** `announceManager` is on, the conversation has a handover time (`handedOverAt`), and no notice has been sent for this handover. Only a manager's action counts: flow steps, trigger actions and AI actions never send it.
- **Handovers without a handover time.** `handedOverAt` is set only by an agent handover with a category. A failure handover (see [Failures](#failures)) and a manager pause do not set it, so they never send a notice.
- **One notice.** The notice time (`managerJoinedAt`) is claimed with a conditional update, so two managers acting at the same time send one notice.
- **Reset.** `managerJoinedAt` is cleared when the bot is turned on again («Return to bot») and when a new agent handover starts, so the next handover can send its own notice.
- The notice is sent as a bot message on the channel and is not signed.

### Sender signature

When `signMessages` is on, the text sent to the channel is prefixed with the sender's name: `Гека: <text>` for agent replies, `Анна: <text>` for manager replies.

- **Agent replies** (the final reply, progress messages and the fallback progress message) use `botName`. Without `botName`, the reply is sent unsigned.
- **Manager replies** (messages a user sends from ChatbotX) use the manager's `User.name`. Without a name, the reply is sent unsigned; the e-mail address is never used.
- **Only the text is prefixed.** An attachment without text is not signed; a caption is. Comment replies and channel templates (for example WhatsApp templates) are not signed.
- **Never signed:** flow-step messages, messages sent through the public API, the join notice, and the handover texts (the time-aware handover confirmation and the failure text).
- **Stored text is unchanged.** The prefix is added only to the copy sent to the channel. The message saved in ChatbotX, and shown in the inbox, is the original text. If the sender's name cannot be read, the reply is sent unsigned and a warning is logged.

### `Conversation.managerJoinedAt`

`Conversation.managerJoinedAt` holds the time the join notice was queued, or `null` when no notice has been sent for the current handover. `conversations.list` and `conversations.get` return it as `managerJoinedAt`.

### Message time in the chat

In the ChatbotX chat, every message shows its send time in the bottom-right corner of the bubble, always visible. This applies to the client's messages, the bot's and the manager's. The time used to appear only on hover.

- **Format:** `HH:mm` for today, `dd.MM HH:mm` for the current year, `dd.MM.yyyy HH:mm` for older messages. The tooltip shows the full date and time with seconds.
- **Scope:** the time is shown in the ChatbotX chat only. Messages sent to the client carry no timestamp. System and activity rows keep their current look.

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
2. The bot is turned off with the failure trigger (resume time from the same policy as above). No handover category is set and no handover push is sent.
3. A note is written to the timeline: «The AI agent is unavailable, the conversation was handed over to a manager» or «The AI agent did not finish in time, the conversation was handed over to a manager». The manager sees these as translated dividers. Repeated notes within the same minute are not duplicated.
4. The failure is written to the error log with provider `hermes` (`logProviderError`), and `failureCount` / `lastError` are saved on the conversation state.

The client never sees technical details.

## Inbox and notifications

Managers see in the conversation list which conversations wait for them, and push notifications follow the same state. The list is sorted and counted by `inboxActivityAt` (a `Conversation` column), not by `lastActivityAt`.

- **Sorting.** The list is sorted by `inboxActivityAt`, newest first. Only client messages and manager replies sent from ChatbotX move a conversation up. Bot messages, broadcasts and system notes do not, and neither do echoes of messages a manager sent from the channel's own app. `lastActivityAt` is unchanged and still serves the other features.
- **Unread.** A conversation is unread when `inboxActivityAt` is later than `agentLastReadAt`, or when `agentLastReadAt` is null. A handover is unread too while it is newer than `agentLastReadAt` (`handedOverAt` later than `agentLastReadAt`, or never read), so a manager sees a handed-over conversation even when no client message is pending. Automatic outbound reads (the `markReadOnOutbound` inbox option) never apply to a conversation waiting for a manager, so the handover confirmation cannot mark it read. A manager's own reply sets both, so it never makes the conversation unread. `unreadCount` counts the unread client messages (`messageType` incoming, `type` message) and is capped at 100. Reading the conversation sets `agentLastReadAt`, so the count drops to 0. The contact filter's `unread` condition uses the same definition.
- **Badge.** Each row shows `unreadCount` as a round badge, hidden at 0 and shown as «99+» at 100. It is red when the bot is off or paused (a manager is needed) and gray when the bot is active. The blue ring around the avatar is gone; unread conversations are shown by the badge and the bold name.
- **Handover category.** After an agent handover, while the bot is off, the row shows a pill with the category (for example «🔥 Срочно»). The chat header then shows «Ждёт менеджера · <category>» with a «Вернуть боту» button. A manager pause with a resume time still in the future shows «Бот на паузе до ЧЧ:ММ» with the same button. Failure handovers set no category (see [Failures](#failures)).
- **Filter.** The conversation filter has a «Категория» multi-select. `conversations.list` takes the same choice as `handoverCategory`.
- **Push to managers.**
  - While the bot answers in an agent inbox, incoming client messages send no push. Other inboxes are unchanged.
  - While the bot is off, or paused until a time still in the future, incoming client messages push as before.
  - On an agent handover while the bot was on, one `notifyAgentHandover` push goes out: title «ИИ-агент передал диалог: <contact name> · <category>», body the reason cut to 150 characters. The recipient is the assigned user, or all workspace members when the conversation is unassigned. A repeat handover on a bot that is already off sends no push and does not change the category.
  - The push title and the category labels are Russian for every workspace, like the client handover text. A contact without a name is shown as «Клиент».

## Keywords and built-in AI

For a conversation in an agent inbox while the bot is on, the incoming-message routing picks the agent route instead of the automated-response route. Keyword replies and AI auto-replies, which run on that route, are therefore skipped for those messages. When the bot is off, the existing handoff re-entry route handles text as before.

This routing decides only the automated-response route. Other automations that react to a message are not suppressed by it; check them per workspace if they must stay silent for agent inboxes.

## Hermes side configuration

These steps are done on the Hermes host, not in this repository. They come from the design record (section 9) and were not verified by the code. The ChatbotX side only needs the base URL and the key.

This configuration is for the **client-facing** agent. The staff assistant
requires its own Hermes profile, loopback port, API key, workspace token and
privacy instructions; see [Staff assistant](staff-chat.md#staff-assistant).
Do not reuse the client profile or token for staff chats.

- **`api_server`** in the `assistant` profile (`/opt/hermes-data/profiles/assistant/config.yaml`): `enabled: true`, `extra.host: 127.0.0.1`, a free port (the design uses 8647), and `extra.key` set to a new key. The key lives in Hermes' secrets and in ChatbotX's encrypted settings; never print it.
- **Toolsets** for `api_server`: `gkamion`, `memory`, `chatbotx`. No `terminal`.
- **MCP server `chatbotx`** with its own workspace token. Give it only the scopes it needs: `inbox` for `externalAgent.handover`, plus the inbox and contact scopes that Hermes needs to read context. It must not carry `settings`, and it cannot create tokens (invariant 23).
- **Instructions (`SOUL.md` or a profile skill):** reply to the client in text; for work longer than about 30 s, say first what is happening and roughly how long it takes; on long tasks report progress now and then (these become the interim messages); when a manager is needed, call the handover tool with a short reason and the `category` that fits best, and tell the client a manager will join.
- The ChatbotX worker runs with host networking (`deploy/gkamion/docker-compose.prod.yml`), so `http://127.0.0.1:<port>` is reachable from it. Restart the profile service after the change (a short Telegram outage); do this only with the owner's approval.
- Check that the port listens only on loopback (`ss -ltnp`).

## Settings and connection check

- **Hermes address** is the origin of the `api_server`, for example `http://127.0.0.1:8647`, with no path. ChatbotX appends `/v1/runs`, `/v1/runs/{id}/events` and `/health`. An address ending in `/v1` produces `/v1/v1/...` and fails. Credentials in the URL and non-http(s) schemes are rejected.
- **API key** is write-only. Leave it empty to keep the stored key.
- **Channels** are opt-in: by default the agent answers nowhere.
- **Bot name, signature and manager notice** are set in the same form: «Bot name» (up to 40 characters), «Sign replies with the sender's name» and «Announce the manager after a handover». The two switches are off by default. See [Manager join notice, signatures and message time](#manager-join-notice-signatures-and-message-time).
- **Test connection** calls `GET {baseUrl}/health` with the key, stores the result (`lastCheckStatus`, `lastCheckedAt`, `lastCheckError`) and is throttled to one check per 10 s (HTTP 429 when repeated).

## Public API, CLI and MCP

| Operation | HTTP | Scope | CLI | Notes |
|---|---|---|---|---|
| `externalAgent.get` | `GET /v1/external-agent` | `settings` | `chatbotx external-agent list` | Returns the settings object, or `null` until configured. The CLI name is derived as `list` because the route is not a singleton; the response is one object. Includes `botName`, `signMessages` and `announceManager`. |
| `externalAgent.update` | `PATCH /v1/external-agent` | `settings` | `chatbotx external-agent update --enabled --baseUrl --apiKey --inboxIds --resumeAfterHours --maxRunMinutes --progressMessage --botName --signMessages --announceManager` | Only the fields you send change. `inboxIds` is a JSON array of ids from `inboxes.list`; `[]` stops every channel. `resumeAfterHours: null` turns automatic resume off. `botName` is up to 40 characters; empty or null clears it. `signMessages` and `announceManager` are booleans; see [Manager join notice, signatures and message time](#manager-join-notice-signatures-and-message-time). |
| `externalAgent.test` | `POST /v1/external-agent/test` | `settings` | `chatbotx external-agent test` | Returns `status`, `error`, `checkedAt`. |
| `externalAgent.handover` | `POST /v1/conversations/{conversationId}/external-agent-handover` | `inbox` | `chatbotx conversations external-agent-handover add <conversationId> --reason "<text>" [--category <category>]` | Pauses the bot without an automatic resume and writes the reason and category as a note. `category` is one of `urgent`, `return`, `payment`, `orderStatus`, `delivery`, `priceAndTerm`, `other` (default `other`). Conversation ids come from `conversations.list` or from the run context. |

- MCP tools: `external_agent_get`, `external_agent_update`, `external_agent_test`, `external_agent_handover`. Only `external_agent_handover` is in the default MCP set; the others are reached through `search_tools` / `call_tool`.
- Conversation reads: `conversations.list` and `conversations.get` return `unreadCount`, `inboxActivityAt`, `handoverCategory`, `handedOverAt` and `managerJoinedAt`. `conversations.list` also filters by `handoverCategory` (a JSON array). See [Inbox and notifications](#inbox-and-notifications).
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
- Inbox attention (no-auto-resume handover, push policy, `notifyAgentHandover`, unread count and store updates) is covered by `packages/business/__tests__/external-agent/bot-resume.test.ts`, `apps/worker/__tests__/incoming-push-policy.test.ts`, `apps/worker/__tests__/notification/agent-handover-push.test.ts` and `apps/builder/__tests__/chat-store-inbox-attention.test.ts`.
- Manager join notice (once per handover, claim, reset), sender signature (agent and manager, skipped cases, stored text unchanged) and message time format are covered by `packages/business/__tests__/external-agent/manager-join.test.ts`, `apps/worker/__tests__/sender-signature*.test.ts`, `apps/builder/__tests__/format-message-time.test.ts` and `apps/builder/__tests__/message-item-timestamp.test.tsx`.
