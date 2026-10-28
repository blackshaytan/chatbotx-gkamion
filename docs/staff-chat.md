# Staff chat API

Staff chat lets workspace members and API agents exchange internal messages.
It is available through the public API under the `chats` group, and therefore
also through the CLI and MCP search tools.

## Access

Chats are privacy-sensitive. A workspace API token must have the explicit
`chats` scope; a legacy token with `scopes: null` is not enough. The APIs are
searchable MCP tools, not tools included in MCP's default set.

## Operations

- `chats.list`, `chats.get`, and `chats.open` find or create a direct chat.
  Opening with one workspace-member id creates an API-agent chat; opening with
  two member ids creates a direct chat.
- `chats.messages.list`, `chats.messages.create`,
  `chats.messages.update`, and `chats.messages.delete` manage messages. API
  messages show the API token's name as their author. Mentions are unsupported.
- `chats.attachments.upload` uploads one file and returns its `key` and `name`.
  Pass those values to `chats.messages.create`.
- `chats.presence` returns the ids of workspace members currently online.

Use `workspaceMembers.list` to obtain member ids, `chats.list` or
`chats.open` to obtain chat ids, and `chats.messages.list` to obtain message
ids. Agents should poll `chats.messages.list` for new messages; this stage does
not provide real-time delivery.

Attachment URLs returned with messages are signed download links. They expire
after about one hour and authorize only the exact workspace, message, and file.

## Staff assistant

An administrator can configure the staff assistant in integration settings or
with `staffAssistant.get`, `staffAssistant.update`, and `staffAssistant.test`
(the public procedures require the `settings` scope). `token.get` returns the
calling token's id for use as `apiTokenId`. Choose a dedicated token with an
explicit `chats` scope; a legacy unscoped token cannot be bound. The assistant
acts with all the permissions of that token, regardless of the permissions of
the employee writing to it. Enable it only when that access is appropriate for
all workspace employees. API keys are write-only.

Each employee has one private assistant chat and a separate Hermes session.
The employee can open it from New chat; a proactive `chats.open` call by the
bound assistant token reaches the same chat. Messages sent by an employee are
forwarded to Hermes, whose responses appear in the chat. A disabled assistant,
or one whose token was revoked or lost the `chats` scope, cannot receive new
requests. Existing chat history remains readable. Attachments supplied to
Hermes use message-specific signed links valid for 24 hours. Provider responses
longer than the chat's 10,000-character limit are truncated.

The Hermes staff profile and its deployment are separate operational steps. It
requires a separate loopback-only gateway and dedicated token. Its instructions
must prohibit storing employees' personal data in shared profile memory or
recounting another employee's conversations. The profile should return replies
through the run rather than posting them to the same chat through the API;
`chats.messages.create` is for proactive messages outside a run. See the ops
checklist in `docs/superpowers/specs/2026-10-27-staff-chat-design.md` §13.11.
The staff assistant database migration and coordinated builder/worker release
must be approved before applying them to production.

### Activation checklist

1. Create a separate `staff` Hermes profile with `api_server` bound to a free
   loopback port and a new API key. Enable the `memory` and `chatbotx` toolsets;
   leave `terminal` disabled. Run it as a separate service with restart on
   failure and verify that its port is not exposed on external interfaces.
2. A workspace super administrator creates a dedicated token with an explicit
   `chats` scope and any other scopes required for the intended work. Avoid
   granting `settings` unless necessary. Configure that same token in the staff
   profile's ChatbotX MCP server and select its id in the staff assistant
   integration settings. Do not copy the client agent's token.
3. Set the profile's memory and privacy rules described above, including the
   instruction to return a run's answer instead of posting a duplicate chat
   message. Configure the Hermes origin and write-only API key in the staff
   assistant settings, enable the integration, and run its connection test.
4. Verify a proactive assistant message and an employee reply arrive in the
   same chat, including the typing indicator and final response. Repeat with a
   second employee to verify separate chats and sessions. Never include token
   values or API keys in logs or the verification report.

## Create a task from a chat message

In the signed-in chat UI, the actions for any non-deleted staff message include
**Create task** when the workspace is writable. The dialog starts with a
Markdown quote of the message and an author/date attribution. It clearly warns
that the quote will be visible to every workspace member who can view tasks.

Creating a task does not create a `TaskTarget`, add a link back to the private
chat, or reveal the chat's existence to other members. This is intentional:
tasks are workspace-visible while direct chats are private.

There is no extra public operation for this action. An agent can read a message
with `chats.messages.list` and call `tasks.create` with an equivalent quoted
description.
