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
