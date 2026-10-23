# Staff tasks

Workspace members, API tokens (for example the Hermes agent) and, later, flows assign tasks to members or teams. Design: `docs/superpowers/specs/2026-10-17-team-tasks-design.md`.

## Data

- `Task` — title, description, status (`todo`, `in_progress`, `done`, `canceled`), priority (`low` … `urgent`), due date, reminder, one assignee (member **or** team), creator (`createdBySource` = `user` | `flow` | `api`, `createdByLabel` for tokens and flows).
- `TaskWatcher` — members who follow the task. The author and a member assignee are added automatically.
- `TaskTarget` — links to a contact, a conversation, a client message (one per row). `messageId` has no foreign key (`Message` is sharded); it is accepted only with its `conversationId`.
- `InternalThread` / `InternalThreadMember` / `InternalMessage` — the task feed: comments and `system` events for every change of status, due date, assignee and priority. The same tables will carry staff chats later.

## Rules

- Everyone in the workspace sees every task. A member restricted to assigned contacts sees links to other contacts as `{ hidden: true }`.
- Author, assignee (or any member of the assignee team) and the owner may change a task; only author and owner may delete it. API tokens and flows act with workspace authority.
- Removing a member from the workspace, or deleting a team, hands their tasks to the workspace owner with a `system` feed entry.
- Due filters `today` / `week` use the workspace time zone.

### Comments (feed)

- **Mentions** — comment text may include `@[Display name](user:<userId>)` or `@[Team name](team:<teamId>)` (same tokens the web editor inserts). Parsed mentions appear on each comment as `mentions.userIds` / `mentions.teamIds`. **Mentioned members** are added as task watchers if they are not already watching. Team mentions are stored and rendered; they do not add watchers or send notifications to the whole team (notification delivery is stage 4).
- **Edit** — the author may edit their comment within **24 hours** of posting. API tokens may edit comments they authored (`authorUserId` is null and `authorLabel` matches the token). System events cannot be edited.
- **Delete** — soft-delete. The author may delete within **24 hours**. The workspace **owner** and **API tokens** (workspace authority) may delete any comment at any time. System events cannot be deleted.

### Attachments

- Up to **10 files per comment**, each up to **25 MB**.
- **Two-step upload:** `tasks.attachments.upload` (multipart, one file) stores the object under `private/space/<workspaceId>/tasks/<taskId>/…` and returns `{ key, name, size, mimeType }`. Then `tasks.comments.create` (or the session API) passes `attachments: [{ key, name }]`. The server validates the key prefix and reads size/MIME from storage (`headObject`); clients cannot spoof metadata.
- **Download** — list/create/update responses expose a signed URL on each attachment (about **one hour**), served by `/media/task-attachment/<token>`. Objects are **not** public-read; nginx on GKamion returns **404** for direct `/storage/private/…` requests.

### Unread counts and read state

- **Unread** — non-system, non-deleted comments from **other** authors, created after the member’s `lastReadAt` on the task thread. Members who are not on the thread see `unreadCount: 0`.
- **`unreadCount`** is returned on task list/get in the **signed-in session API only** (personal state). There is **no** public `tasks.markRead` — same rationale as other per-user UI state (notification center): agents use list/get without implying another user’s read cursor.
- The web app calls the private **`markRead`** when the feed is viewed (throttled). Opening a task or receiving realtime updates refreshes counts in the task table without a full page reload.

## Interface

Signed-in staff use the session `tasksAPI` router (same service methods as the public API, plus `unreadCount` and `markRead`). Tabs map to list filters: **Mine** → `assigneeUserId` (current member), **Created by me** → `createdByUserId`, **Watching** → `watcherUserId`, **My teams** → `teamMemberUserId`, **All** → no tab filter. Additional filters: status (including `open`), priority, due (`overdue`, `today`, `week`, `none`), assignee, contact, conversation.

- **Tasks page** — `/space/[workspaceId]/tasks` (sidebar item **Tasks** for every member). The sidebar shows a badge with the count of **my open overdue** tasks (`tasks.count` with `assigneeUserId`, `status: open`, `due: overdue`). Table columns: status (click to change), title, assignee, due (overdue styling), priority, linked contact when visible, **unread** badge when the member has unread comments on that task.
- **Task card** — side sheet on the list via `?task=<id>`, or the direct page `/space/[workspaceId]/tasks/<taskId>` (same card; API `url` points here). Left: editable fields, links, watchers; **Take** for team-assigned tasks (assigns to the current member). Right: comment feed with **@ mentions** (members and teams), **file attachments**, edit/delete on own comments (within policy), and a composer that accepts text and/or files.
- **Create task** — dialog from the Tasks page or the contact panel: title, description, assignee (member or team), watchers, due date, reminder (presets: 15 minutes, 1 hour, 1 day before due), priority, optional contact / conversation / message links.
- **Contact panel** — **Tasks** block lists open tasks for the contact, **Create** opens the dialog with contact (and conversation when in inbox) prefilled; links open the task card or filtered task list.
- **Conversation header** — when the active conversation has open tasks, a badge shows the count and links to the filtered Tasks page.

Lists and feeds refresh after mutations via TanStack Query invalidation (`useInvalidateTasks`) and **realtime** events (below).

### Realtime

The builder publishes workspace-wide party events (payload is ids only; clients refetch with their own permissions):

| Event | Payload | Typical client action |
|---|---|---|
| `taskChanged` | `{ taskId }` | Invalidate task list/detail (status, assignee, unread badge on row). |
| `taskCommentsChanged` | `{ taskId }` | Invalidate comment feed and task row unread count. |

Published after public and private comment/task mutations (not when tasks are reassigned to the owner on member removal).

## API

Public operations under the `tasks` token scope: `tasks.list`, `tasks.count`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.take`, `tasks.delete`, `tasks.addWatcher`, `tasks.removeWatcher`, `tasks.comments.list`, `tasks.comments.create`, `tasks.comments.update`, `tasks.comments.delete`, `tasks.attachments.upload`.

- **List / count filters** (same set): `status`, `priority`, `due`, `assigneeUserId`, `assigneeTeamId`, `createdByUserId`, `watcherUserId`, `teamMemberUserId` (tasks assigned to any team the member belongs to), `contactId`, `conversationId`. `tasks.list` returns `{ data, pageCount }`; `tasks.count` returns `{ total }`.
- **Take** — `POST /v1/tasks/{id}/take` with body `userId` (member who claims a team task; must belong to the assignee team). The web UI passes the signed-in member.
- **Comments** — create accepts optional `text` (mention format above) and/or `attachments` from the upload step. Update changes `text` only. List returns newest first (comments and `system` events).
- **Upload** — `POST /v1/tasks/{id}/attachments` multipart body (field `file`, one file, max 25 MB).
- **Response fields** — each task includes `url` (web app link to `/space/<workspaceId>/tasks/<id>`). Each target includes `label` (contact `fullName` when the contact link is visible; otherwise `null`). Each comment attachment includes a short-lived signed `url`.

`tasks.list` and `tasks.create` are in the MCP default tool set. `tasks.count`, `tasks.take`, comment update/delete, attachment upload, and other task operations are available via CLI commands or MCP `search_tools` → `call_tool`.

## Not yet

- **Stage 4** — notification center, reminder/overdue delivery, mention/assignment notifications (including team mention delivery), related settings.
- **Later cleanup** — orphan attachment objects after unused uploads and files on deleted tasks (upload keys are validated on comment create but not garbage-collected yet).
- Web push (stage 5); staff MAX bot (stage 6); the `createTask` flow step and **Create task** from a client message menu (stage 7).
