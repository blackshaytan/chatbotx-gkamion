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

## Interface

Signed-in staff use the session `tasksAPI` router (same service methods as the public API). Tabs map to list filters: **Mine** → `assigneeUserId` (current member), **Created by me** → `createdByUserId`, **Watching** → `watcherUserId`, **My teams** → `teamMemberUserId`, **All** → no tab filter. Additional filters: status (including `open`), priority, due (`overdue`, `today`, `week`, `none`), assignee, contact, conversation.

- **Tasks page** — `/space/[workspaceId]/tasks` (sidebar item **Tasks** for every member). The sidebar shows a badge with the count of **my open overdue** tasks (`tasks.count` with `assigneeUserId`, `status: open`, `due: overdue`). Table columns: status (click to change), title, assignee, due (overdue styling), priority, linked contact when visible.
- **Task card** — side sheet on the list via `?task=<id>`, or the direct page `/space/[workspaceId]/tasks/<taskId>` (same card; API `url` points here). Left: editable fields, links, watchers; **Take** for team-assigned tasks (assigns to the current member). Right: comment feed and a plain text comment box (no `@` mentions or attachments yet).
- **Create task** — dialog from the Tasks page or the contact panel: title, description, assignee (member or team), watchers, due date, reminder (presets: 15 minutes, 1 hour, 1 day before due), priority, optional contact / conversation / message links.
- **Contact panel** — **Tasks** block lists open tasks for the contact, **Create** opens the dialog with contact (and conversation when in inbox) prefilled; links open the task card or filtered task list.
- **Conversation header** — when the active conversation has open tasks, a badge shows the count and links to the filtered Tasks page.

Lists refresh after mutations via TanStack Query invalidation (`useInvalidateTasks`); there is no live realtime feed yet.

## API

Public operations under the `tasks` token scope: `tasks.list`, `tasks.count`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.take`, `tasks.delete`, `tasks.addWatcher`, `tasks.removeWatcher`, `tasks.comments.list`, `tasks.comments.create`.

- **List / count filters** (same set): `status`, `priority`, `due`, `assigneeUserId`, `assigneeTeamId`, `createdByUserId`, `watcherUserId`, `teamMemberUserId` (tasks assigned to any team the member belongs to), `contactId`, `conversationId`. `tasks.list` returns `{ data, pageCount }`; `tasks.count` returns `{ total }`.
- **Take** — `POST /v1/tasks/{id}/take` with body `userId` (member who claims a team task; must belong to the assignee team). The web UI passes the signed-in member.
- **Response fields** — each task includes `url` (web app link to `/space/<workspaceId>/tasks/<id>`). Each target includes `label` (contact `fullName` when the contact link is visible; otherwise `null`).

`tasks.list` and `tasks.create` are in the MCP default tool set. `tasks.count`, `tasks.take`, and other task operations are available via CLI commands or MCP `search_tools` → `call_tool`.

## Not yet

Unread comment counts, `@` mentions, attachments and realtime task updates (stage 3); notification center, reminder/overdue delivery and related settings (stage 4); web push (stage 5); staff MAX bot (stage 6); the `createTask` flow step and **Create task** from a client message menu (stage 7).
