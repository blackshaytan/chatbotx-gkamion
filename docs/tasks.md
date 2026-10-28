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

- **Mentions** — comment text may include `@[Display name](user:<userId>)` or `@[Team name](team:<teamId>)` (same tokens the web editor inserts). Parsed mentions appear on each comment as `mentions.userIds` / `mentions.teamIds`. **Mentioned members** are added as task watchers if they are not already watching. Team mentions expand to all members of that inbox team for notifications (see **Notifications**).
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

- **Tasks page** — `/space/[workspaceId]/tasks` (sidebar item **Tasks** for every member). The sidebar shows a badge with the count of **my open** tasks (`tasks.count` with `tab: mine` → `assigneeUserId`, `status: open`). Counts above 99 render as `99+`. A zero count hides the badge. Table columns: status (click to change), title, assignee, due (overdue styling), priority, linked contact when visible, **unread** badge when the member has unread comments on that task.
- **Task card** — side sheet on the list via `?task=<id>`, or the direct page `/space/[workspaceId]/tasks/<taskId>` (same card; API `url` points here). Left: editable fields, links, watchers; **Take** for team-assigned tasks (assigns to the current member). Right: comment feed with **@ mentions** (members and teams), **file attachments**, edit/delete on own comments (within policy), and a composer that accepts text and/or files.
- **Create task** — dialog from the Tasks page or the contact panel: title, description, assignee (member or team), watchers, due date, reminder (presets: 15 minutes, 1 hour, 1 day before due), priority, optional contact / conversation / message links.
- **Contact panel** — **Tasks** block lists open tasks for the contact, **Create** opens the dialog with contact (and conversation when in inbox) prefilled; links open the task card or filtered task list.
- **Conversation header** — when the active conversation has open tasks, a badge shows the count and links to the filtered Tasks page.
- **Inbox message menu** — on an **incoming** client message (including comments), the message actions menu includes **Create task**. It opens the create dialog with a markdown **quote** of the message body (truncated to the task description limit) and prefilled links to the contact, conversation, and message. Outgoing messages and webchat preview without inbox context do not show the action. No new public API: the dialog calls existing `tasks.create` with `contactId`, `conversationId`, and `messageId`.
- **Staff chat message menu** — on any non-deleted staff message, a writable member can choose **Create task**. The description contains a markdown quote plus its author and date, and the dialog warns that the quote is visible to all workspace members. It intentionally creates no `TaskTarget` and no chat link: a direct chat must not be disclosed through a workspace-visible task. Agents use `chats.messages.list` followed by `tasks.create` to achieve the same result.

Lists and feeds refresh after mutations via TanStack Query invalidation (`useInvalidateTasks`) and **realtime** events (below).

### Realtime

The builder publishes workspace-wide party events (payload is ids only; clients refetch with their own permissions):

| Event | Payload | Typical client action |
|---|---|---|
| `taskChanged` | `{ taskId }` | Invalidate task list/detail (status, assignee, unread badge on row). |
| `taskCommentsChanged` | `{ taskId }` | Invalidate comment feed and task row unread count. |
| `notificationCreated` | `{ notificationId }` | Invalidate the signed-in member’s notification list and unread badge (user-targeted; not workspace-wide). |

Published after public and private comment/task mutations (not when tasks are reassigned to the owner on member removal). The integration worker also publishes `taskChanged` after a flow **Create task** step creates a task, so open Tasks pages refresh without reload. `notificationCreated` is sent only to each notification recipient after a row is inserted.

### Flow step: Create task

The **`createTask`** step lives inside the **Perform action** node (same menu as **Call API**). Configure it in the flow builder under **Create task**.

| Setting | Behavior |
|---|---|
| Title / description | Templates with contact/conversation variables; substituted and truncated to task limits (255 / 10 000) before create. Empty title after substitution → **error** output. |
| Assignee | **Member** (`userId`), **team** (`teamId`), or **Assigned to conversation** (fresh `Conversation.assignedUserId`, else assigned inbox team; no assignee → **error**). Default: conversation. |
| Due / reminder | Relative due (`amount` + minutes/hours/days) or none; optional reminder N minutes before due (requires a due date). |
| Priority | `low` … `urgent`. |
| Output field | Optional custom or bot field id; receives the new task id. Missing field or failed write → **success** anyway; worker logs a warning. |

The step always links the current **contact** and **conversation** (`messageId` is not set). The actor is `{ kind: "flow", label: <active flow name> }` (fallback label **Flow**). Outputs: **success** (result includes `taskId`) and **error** (assignee not in workspace, team missing or empty, conversation unassigned, empty title, or other create failure).

Like other non-idempotent flow steps, a retried flow job can run **Create task** again and create a duplicate task.

**Notifications:** the **integration** worker registers `registerNotificationRealtime()` (like the schedule worker), so assignees get **`notificationCreated`** in the bell without reload.

**Flow import:** `outputFieldId` is remapped; assignee `userId` / `teamId` are **not** remapped across workspaces (same as `autoAssignConversation`) — the step may take the **error** output after import.

## Notifications

Personal task alerts live in the **Notification** table (`workspaceId`, `userId`, `type`, `entityType` = `task`, `entityId`, `payload`, `readAt`). Deleting a task deletes its notifications in the same transaction.

### Types

| Type | When it is created |
|---|---|
| `taskAssigned` | Task created or assignee changes (member or every member of an assignee team). |
| `taskMentioned` | Comment create/update adds a new `@user` or `@team` mention (teams expand to members). |
| `taskCommented` | New comment on the task (watchers only; see below). |
| `taskStatusChanged` | Status changes (`payload.from` / `payload.to`). |
| `taskDueChanged` | Due date changes (`payload.from` / `payload.to`). |
| `taskReminder` | Scheduled reminder time is reached (assignee or assignee team). |
| `taskOverdue` | Due date passed while status is `todo` or `in_progress` (assignee/team plus task author). |

Comment notifications include a short `payload.excerpt` (mentions rendered as `@Display name`).

### Recipients

- **One notification per member per action.** If several events fire together, the highest-priority type wins: `taskMentioned` > `taskAssigned` > `taskStatusChanged` > `taskDueChanged` > `taskCommented`. A comment that both mentions someone and notifies watchers therefore sends **`taskMentioned`**, not a separate `taskCommented`, to that person.
- **Actor excluded** — the member who performed the action (`actorUserId`) never receives a notification for that action. System/API actors (`actorUserId` null) do not suppress anyone.
- **Watchers** receive `taskCommented`, `taskStatusChanged`, and `taskDueChanged`. Mentioned users on the same comment are excluded from `taskCommented` (they already get `taskMentioned`).
- Only **current workspace members** are eligible; non-members are dropped.

### Preferences

Per-member toggles live in `WorkspaceMember.notificationTypes` next to existing notification keys. **Missing key = enabled.** When a type is disabled, **no row is created** (the in-app bell is the only delivery channel for stage 4). The profile menu **Notifications** dialog exposes all seven task types; changes save immediately.

### Reminders and overdue

- Worker schedule **`taskDueScan`** runs **every minute** under a distributed lock and calls `notificationService.processDueTaskNotifications`, which claims tasks in batches (`claimDueReminders` / `claimOverdue` set `remindedAt` / `overdueNotifiedAt` in the same `UPDATE … RETURNING`). The `team_task_notifications` migration stamps both flags on tasks already past their reminder/due time, so the first scan after deploy does not notify the backlog.
- Each task is notified **at most once** per reminder or overdue cycle until the due/reminder fields change (task updates clear the corresponding flag so a moved due date can fire again).
- **`withBlockedOwnerGuard`** skips notification delivery for blocked owners (same pattern as broadcasts). The claim flag is set **before** that guard runs, so a blocked workspace **does not** get that reminder/overdue notification and will not retry until the schedule is reset by editing the task.
- Completed/canceled tasks are not claimed. **`purgeOldNotifications`** (daily) deletes rows older than **90 days** in batches.

### In-app center

Signed-in members use the private **`notificationsAPI`** (`list`, `countUnread`, `markRead`, `markAllRead`, `getPreferences`, `updatePreferences`) — same service methods as the worker/task hooks, scoped to `context.user.id`. The sidebar **bell** (above the profile menu) shows unread count, a popover list, **Mark all read**, and navigation to the task on click (marks read). Realtime **`notificationCreated`** refreshes the list without reload (`useInvalidateNotifications`). Deploy **`apps/realtime`** together with builder when shipping notification center changes so `REALTIME_EVENT_TOPICS` includes `notificationCreated` on the workspace party.

There is **no public API** for the notification center or personal notification settings (spec section 6): these are per-user UI state, like `tasks.markRead`, not workspace-token operations for agents.

## API

Public operations under the `tasks` token scope: `tasks.list`, `tasks.count`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.take`, `tasks.delete`, `tasks.addWatcher`, `tasks.removeWatcher`, `tasks.comments.list`, `tasks.comments.create`, `tasks.comments.update`, `tasks.comments.delete`, `tasks.attachments.upload`.

- **List / count filters** (same set): `status`, `priority`, `due`, `assigneeUserId`, `assigneeTeamId`, `createdByUserId`, `watcherUserId`, `teamMemberUserId` (tasks assigned to any team the member belongs to), `contactId`, `conversationId`. `tasks.list` returns `{ data, pageCount }`; `tasks.count` returns `{ total }`.
- **Take** — `POST /v1/tasks/{id}/take` with body `userId` (member who claims a team task; must belong to the assignee team). The web UI passes the signed-in member.
- **Comments** — create accepts optional `text` (mention format above) and/or `attachments` from the upload step. Update changes `text` only. List returns newest first (comments and `system` events).
- **Upload** — `POST /v1/tasks/{id}/attachments` multipart body (field `file`, one file, max 25 MB).
- **Response fields** — each task includes `url` (web app link to `/space/<workspaceId>/tasks/<id>`). Each target includes `label` (contact `fullName` when the contact link is visible; otherwise `null`). Each comment attachment includes a short-lived signed `url`.

`tasks.list` and `tasks.create` are in the MCP default tool set. `tasks.count`, `tasks.take`, comment update/delete, attachment upload, and other task operations are available via CLI commands or MCP `search_tools` → `call_tool`.

The **Create task** flow step is part of flow configuration: publish or update drafts with `flows.publish` / `flows.updateDraft` (`createTask` in a `performAction` node’s `steps`). No new token scopes or public operations were added for the step itself.

## Not yet

- **Later cleanup** — orphan attachment objects after unused uploads and files on deleted tasks (upload keys are validated on comment create but not garbage-collected yet).
- **Web push** for task notifications (stage 5); **staff MAX bot** channel (stage 6); **60s coalescing** / `notificationDispatch` queue (stages 5–6).
