# SMTP Mailbox Ownership & Visibility Design Spec

**Date:** 2026-11-26  
**Status:** Approved by owner (2026-11-26)  
**Scope:** Subsystem A only (personal vs shared SMTP + visibility). The composer channel picker is subsystem B, designed separately.

## Summary

An SMTP inbox is **shared** (default) or **personal** (owned by one workspace member). In a member's session, messages on a personal SMTP inbox are visible only to its owner and to members with `permissions.superAdmin`. Other members still see the conversation if the contact has another channel, just without those emails. Assignment is not access control; it is added as a convenience (auto-assign the owner on inbound when unassigned). Workspace API tokens keep full access.

## Context (verified in code)

- `Inbox` (`packages/database/src/schema/inbox.ts`) has no owner column.
- The inbox list shows every workspace conversation. `assignedId` is only an optional filter (`build-conversation-where.ts`). `onlyAssignedContacts` restricts contact reads, not this list.
- `listConversations` / `findConversation` (`apps/builder/src/features/conversations/queries/list-conversations.query.ts`) already take a per-caller `access` object (`{ includeEmailAndPhone }`), resolved from member permissions on the private path and set to full for tokens. This design extends that object.
- Message history: `listForConversation` (`packages/business/src/message/list-for-conversation.ts`) → `repository.listByConversation`. Messages carry `contactInboxId`.
- Server send resolution: `conversationService.resolveContactInboxForConversation` (private) / `resolveContactInboxForSend` (public). Both fall back to `findRecentByContactId` when no `inboxId` is given.
- Realtime: `messageCreated` and similar events carry the **full message** and go to the whole workspace room via `publishToWorkspaceParty`, from about 20 call sites (worker handlers, builder actions, business services). `sendToWorkspaceMember` already supports targeting one member.
- New-message notification is mobile push only: `apps/worker/src/notification/handlers/send-push.ts` → `resolveRecipientUserIds` sends to the assignee, or to **every member** when unassigned. The payload includes `messageText`.
- SMTP create/update actions use plain `workspaceActionClient` with no admin check. The channel-create page requires `superAdmin`.

## Design

### 1. Data model

```ts
// Inbox — additive, nullable
ownerUserId: bigintAsString().references(() => userModel.id, {
  onDelete: "set null", // only fires when the User row is deleted
  onUpdate: "cascade",
})
// null = shared; non-null allowed only when channel === "smtp"
```

- Index `(workspaceId, ownerUserId)`.
- On write: the owner must be a member of the same workspace, and the inbox channel must be `smtp`.
- Removing a member does not delete the `User` row, so the FK alone does not handle it. `workspaceMemberService.delete` (same transaction) clears the owner: `UPDATE "Inbox" SET "ownerUserId" = NULL WHERE "workspaceId" = $ws AND "ownerUserId" = $user`.

### 2. Access rule: one precomputed list

The business layer computes the inboxes a member must not see once per request:

```ts
// packages/business — e.g. inboxService.listHiddenInboxIdsForMember
hiddenInboxIds = superAdmin
  ? []
  : personal SMTP inboxes in workspace where ownerUserId !== userId
```

- Member session: `access.hiddenInboxIds = await …` (beside `includeEmailAndPhone`).
- Workspace token: `hiddenInboxIds` is undefined, so nothing is filtered.
- Platform support sessions have synthetic `superAdmin`, so they see everything (consistent with `docs/support-access.md`).

Every member read applies the same rule in **SQL** (not by filtering after `limit`), so pagination stays correct. Messages live in sharded tables with no `Inbox` join. Message queries therefore receive `excludeContactInboxIds`: the contact's ContactInbox ids whose `inboxId` is hidden, resolved in the main DB before the shard query.

### 3. Read paths (member session)

| Path | Rule |
| --- | --- |
| `listConversations` where | Keep a conversation only if it has at least one ContactInbox whose `inboxId` is not hidden. Add the condition to `buildConversationWhere`. |
| `contactInboxes` in the response | Drop the hidden ones. |
| Last-message preview | The per-conversation last-message query excludes messages on hidden ContactInboxes, so the preview is the latest visible message. |
| Unread count | `countUnreadIncomingByConversations` excludes hidden ContactInboxes. |
| `findConversation` | Not found if no visible ContactInbox remains. |
| `listForConversation` / `findForContact` | Exclude messages whose ContactInbox is hidden. An explicit hidden `contactInboxId` returns not found. |

**Accepted limitation:** `Conversation.inboxActivityAt` and the unread rank are columns on the conversation row, shared by everyone. In a mixed-channel conversation, a hidden email still moves the conversation up the list for every member, with no visible new message. Per-viewer activity columns are not worth adding for this.

### 4. Send paths

- `resolveContactInboxForConversation` takes `hiddenInboxIds`. An explicit hidden `inboxId` returns not found. The fallback picks the most recent **visible** ContactInbox.
- The client `resolveActiveContactInbox` operates only on the already-filtered `contactInboxes`. No separate client change is needed beyond receiving the filtered data.
- Owner and `superAdmin` may send from a personal SMTP inbox. The From address is that mailbox.

### 5. Inbound personal SMTP (worker `received-message.ts`)

1. Save the message as today.
2. If the inbox is personal and the conversation has neither `assignedUserId` nor `assignedInboxTeamId`, set `assignedUserId = ownerUserId` through the existing assign service, so assign events and notifications stay consistent.
3. Push: add `inboxId` to the `notifyIncomingMessage` job. In `resolveRecipientUserIds`, a personal SMTP inbox gives recipients = `{owner} ∪ superAdmin members` (minus `excludeUserId`), ignoring assignee and fan-out.

### 6. Realtime

Add one business helper, e.g. `publishMessageEvent({ workspaceId, inbox | contactInboxId, event })`:

- Shared or non-SMTP inbox: `publishToWorkspaceParty`, unchanged.
- Personal SMTP inbox: `sendToWorkspaceMember` for each of `{owner} ∪ superAdmin members`.

Route every **content-bearing** publish that can carry an SMTP message through it: `messageCreated` and `messageUpdated` sites that have a `contactInbox` / `contactInboxId` in scope. Those are `received-message.ts` inbound, `create-outgoing.ts` (manager reply), `send-flow-step.ts`, and the builder `edit-message.action.ts`. Id-only events (`messageDeleted`, `messageIdAssigned`, `messageFailed`) carry no text and stay workspace-wide. Channel-specific sites that can never be SMTP also stay as they are: calls, comments, reactions, Messenger/WhatsApp templates, thread control, external-agent activity. The client refetches through the filtered queries, so conversation-level events stay workspace-wide.

### 7. Broadcast, flow, bot

- Broadcast with explicit `inboxIds` that include a personal SMTP inbox: validation error.
- Broadcast audience built from `channels: ["smtp"]` / `omnichannel` / integration id: personal SMTP inboxes are excluded during expansion. If nothing remains, it is the existing empty-audience error.
- Flow and bot sends may use a personal SMTP inbox.

### 8. Settings and API

- **UI** (`integration-smtp` create/edit forms): Shared or Personal, plus a member select. Shown only to `superAdmin`. Strings come from `useTranslations()`.
- **Actions** (`create-smtp.action.ts`, `update-smtp.action.ts`): setting or changing `ownerUserId` requires `hasWorkspacePermission(…, "superAdmin")` on the server.
- **Public API**:
  - `smtpIntegrations.create` / `update` accept `ownerUserId: string | null`.
  - `smtpIntegrations.get` / `list` and `inboxes.list` return it.
  - The existing `channels` / `inbox` token scopes authorize this (tokens are workspace-level).
  - Descriptions say where member ids come from.
  - Then run `cli-mcp-docs`.

## Errors

| Situation | Result |
| --- | --- |
| Member without access opens a conversation that is only on a hidden inbox, or a hidden message / `contactInboxId` | Not found (same as a missing id) |
| Member without access sends via a hidden inbox | Not found (from send resolution) |
| Non-`superAdmin` member sets `ownerUserId` via action | Permission error |
| Owner is not a workspace member, or inbox is not SMTP | Validation error |
| Broadcast explicitly includes a personal SMTP inbox | Validation error |

## Testing

| # | Setup | Expected |
| --- | --- | --- |
| T1 | Shared SMTP, any member | Unchanged behaviour |
| T2 | Contact only on personal SMTP (owner U1); viewer U2 | Absent from list; get → not found |
| T3 | WhatsApp + personal SMTP, latest message is SMTP; viewer U2 | Listed; preview is the latest WhatsApp message; `contactInboxes` has no SMTP entry |
| T4 | Same; `listForConversation` limit 2 with 1 WhatsApp + 3 SMTP messages | Returns only the WhatsApp message; next page is empty |
| T5 | Same; unread only on SMTP | Unread count 0 for U2 |
| T6 | List page size N where some conversations are SMTP-only hidden | Page still holds N visible conversations (filter is in SQL) |
| T7 | Inbound on personal SMTP, unassigned | Assigned to U1 |
| T8 | Inbound on personal SMTP, assigned to U3 | Still U3; U3 still cannot see SMTP if not owner/admin |
| T9 | Push recipients for inbound personal SMTP | `{U1} ∪ superAdmins`, regardless of assignee |
| T10 | Realtime for a personal SMTP message | Targeted sends only; no workspace-room publish |
| T11 | U2 sends with personal `inboxId` | Not found; U1 and a superAdmin succeed |
| T12 | U2 sends with no `inboxId`, contact has WhatsApp + personal SMTP | Goes via WhatsApp |
| T13 | Remove member U1 | Their inboxes get `ownerUserId = null` |
| T14 | Broadcast `inboxIds: [personal]` | Validation error |
| T15 | Broadcast `channels: ["smtp"]`, with one personal and one shared SMTP inbox | Uses only the shared one; only personal → empty-audience error |
| T16 | Flow email step from personal SMTP | Sent |
| T17 | Token `conversations.get` / `messages.list` on personal SMTP | Full data |
| T18 | Non-admin `updateSmtpAction` with `ownerUserId` | Permission error; admin and token succeed and `get` returns the value |

Unit tests: `listHiddenInboxIdsForMember`, the `buildConversationWhere` condition, recipient resolution, broadcast expansion. Targeted worker tests: auto-assign and realtime routing. Use the `testing-workflow` skill; no full suite on production.

## Migration and rollout

1. `make:migration`: nullable `Inbox.ownerUserId` plus index. Inspect the SQL; **apply `db:migrate` only after explicit owner approval**.
2. Deploy. `null` means shared, so existing inboxes are unaffected and need no backfill.
3. Admins mark personal mailboxes in settings.

Rollback: stop writing the column; it can stay.

## Out of scope

- Composer channel picker (subsystem B).
- Ownership for non-SMTP channels.
- Hiding the contact or its SMTP address in the Contacts section. Only message content is protected.
- Per-viewer conversation activity / ordering (see the limitation in §3).
- Restricting workspace API tokens.
- Manager email signatures (separate spec).

## Decision log

| Decision | Chosen | Why |
| --- | --- | --- |
| Order | Ownership first, picker later | The picker must know which inboxes a viewer may use |
| Visibility | Hide SMTP messages; keep the conversation if another channel exists | Protects the mail, keeps omnichannel |
| Assignment | Not ACL; auto-assign the owner only if unassigned | Assignment is a label/filter; don't steal assigned work |
| Admins | `superAdmin` reads **and** sends | Cover vacations and incidents |
| Automation | No broadcast from personal; flow/bot allowed | Mass mail from a personal address defeats the purpose |
| Owner leaves | Mailbox becomes shared (cleared in member delete) | No stuck mailbox; the FK doesn't cover membership removal |
| Existing inboxes | Shared | No surprise in production |
| API tokens | See everything | Owner's choice; privacy targets people in the UI |
| Push | Owner + admins | Matches who can see the mail; today unassigned pushes go to everyone |
| Who configures | `superAdmin` only, enforced on the server | Matches channel settings |
| Storage | `Inbox.ownerUserId` | Read paths already join `contactInbox → inbox` |
| Enforcement shape | Precomputed `hiddenInboxIds` in the existing `access` object, applied in SQL | Reuses the current per-caller access pattern; correct pagination |
| Realtime | One `publishMessageEvent` helper; targeted sends for personal SMTP | Workspace-room payloads contain the full message |
