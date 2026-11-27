# SMTP mailbox ownership (personal vs shared)

An SMTP inbox can be **shared** (default) or **personal** (`Inbox.ownerUserId` set to a workspace member).

## Who sees what

| Viewer | Shared SMTP | Personal SMTP (other owner) | Personal SMTP (own) |
| --- | --- | --- | --- |
| Owner of the mailbox | yes | — | yes |
| Other members | yes | hidden (not found / filtered) | no |
| Workspace `superAdmin` | yes | yes | yes |
| Workspace API token | yes | yes | yes |

Hidden means the same as missing: conversation/message list and get return empty or not-found. There is no distinct “forbidden mailbox” error.

## Behaviour

- **Settings / public API:** Admins can mark an SMTP inbox personal or shared (`ownerUserId`). Removing a member clears their ownership.
- **Inbox UI:** Members only see conversations/messages from inboxes they are allowed to view. Send falls back to the newest *visible* contact inbox.
- **Inbound:** Personal SMTP auto-assigns the owner when the conversation is unassigned. Push and realtime for personal SMTP go to the owner plus workspace admins (not the whole room).
- **Broadcasts:** Personal SMTP inboxes cannot be broadcast targets (server rejects; picker hides them). Shared SMTP remains usable.
- **Tokens:** Workspace token paths never apply the member visibility filter.

## Migration

Schema adds nullable `Inbox.ownerUserId`. Apply the generated migration only after explicit approval (`db:migrate` is not automatic).
