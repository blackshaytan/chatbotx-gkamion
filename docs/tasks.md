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

## API

Public operations under the `tasks` token scope: `tasks.list`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.delete`, `tasks.addWatcher`, `tasks.removeWatcher`, `tasks.comments.list`, `tasks.comments.create`. `tasks.list` and `tasks.create` are in the default MCP tool set.

## Not yet

UI (stage 2), mentions/attachments/realtime (stage 3), notifications and reminders (stage 4), web push (stage 5), staff MAX bot (stage 6), the `createTask` flow step (stage 7).
