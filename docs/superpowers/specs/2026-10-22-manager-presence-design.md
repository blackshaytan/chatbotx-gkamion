# Manager presence: join notice, sender signature, message time

Date: 2026-10-22. Status: draft for approval.

## Goal

1. The client learns, by name, that a manager took the conversation after the AI agent handed it over.
2. Every reply the client receives in an AI-agent inbox says who wrote it: `Гека: <text>` for the agent, `Анна: <text>` for a manager.
3. A manager sees the date and time of every message in the ChatbotX chat, in the bottom-right corner of the bubble, without hovering.

## Decisions (agreed with the user)

- Join notice fires once per handover, on whichever comes first: the conversation is assigned to a manager, or a manager sends the first reply after the handover.
- Manager name = `User.name` from the profile. If empty, the notice has no name and replies get no prefix (never the e-mail).
- Signature applies to both the agent and managers.
- The agent's name is set in the AI-agent settings (next to the other Hermes settings).
- Time is shown in the ChatbotX chat only; messages to the client do not get a timestamp.

## Scope

Only inboxes connected to an enabled external agent (`externalAgentService.getRuntime` returns a runtime). Other inboxes and flow-only bots behave exactly as today.

## Data

`ExternalAgent` (one row per workspace), new columns:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `botName` | text, nullable | null | Name used in the agent signature, e.g. «Гека». Null = no agent prefix. |
| `signMessages` | boolean | false | Prefix replies with the sender name. |
| `announceManager` | boolean | false | Send the join notice. |

`Conversation`, new column `managerJoinedAt` (timestamp, nullable): set when the join notice was sent (or the join was recorded). Cleared together with `handoverCategory`/`handedOverAt` when the bot is turned back on, and on a new handover.

One migration; every insert path writes the boolean defaults explicitly (see AGENTS.md note on drizzle defaults).

## Behaviour

### Join notice

- Text: «Вам отвечает менеджер {name}»; without a name: «Вам отвечает менеджер». Constant next to `EXTERNAL_AGENT_HANDOVER_CLIENT_TEXT`.
- Conditions: `announceManager` on, the conversation has `handedOverAt`, `managerJoinedAt` is null, and the trigger is a human user (not a flow step, not an AI action).
- Triggers:
  - assignment of the conversation to a user (`assignByContactIds`, `assignOne`; the UI dialog and the public/private API all go through these). Team assignment does not fire.
  - first manager reply (`createOutgoing` with a user) — the notice is enqueued before the reply on the same queue so the client sees it first.
- `managerJoinedAt` is claimed with a conditional update (`WHERE managerJoinedAt IS NULL`), so two managers acting at once send one notice.
- Sent as a bot message (`sendChatMessage`), not signed, never marks the conversation read.

### Signature

- Applied at channel send time (`sendMessageToChannel` / `sendChatMessage` in the worker); the stored message text stays unchanged, so the inbox shows the original text.
- Format: `{name}: {text}`. Only the text part: attachment-only messages get no prefix; a caption gets it. Skipped for comment replies, channel templates (e.g. WhatsApp templates) and the join notice / handover confirmation.
- Agent messages (final reply, progress messages, fallback progress) use `botName`; manager messages (`senderType = user`) use `User.name`. Flow-step messages and public API sends (`senderType = api`) are not signed.

### Message time in the chat

- `message-item.tsx`: the hover-only time beside the bubble is replaced by a small muted time inside the bubble, bottom-right, always visible — on every message: the client's, the bot's and the manager's.
- Format: today `HH:mm`; this year `dd.MM HH:mm`; older `dd.MM.yyyy HH:mm`. The tooltip keeps the full timestamp.
- Activity/system rows (`full` variant) keep their current look.

## API and docs (agent-first)

- `externalAgent.get` / `externalAgent.update` (public and private) gain `botName`, `signMessages`, `announceManager` with descriptions; CLI/MCP docs via `cli-mcp-docs`.
- `conversations.get`/`list` expose `managerJoinedAt`.
- No new operation: the join notice and signatures are side effects of existing operations (assign, send message).
- Settings form: three fields in the AI-agent settings, i18n in all 22 locales.
- `docs/external-agent.md` updated.

## Tests

- Business: join notice once (assign then reply, reply then assign, concurrent claim), not without handover, not for team assignment, cleared on bot enable; settings round-trip.
- Worker: prefix for agent and manager, no prefix for flow/api/comment/template/attachment-only, no prefix when the setting is off or the name is empty.
- Builder: time format (today / this year / older), settings form fields, public API schema.

## Out of scope

- Restricting the conversation list to assigned managers (`onlyAssignedContacts`) — separate task.
- Timestamps inside the client's messages.
