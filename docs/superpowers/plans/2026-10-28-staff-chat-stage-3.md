# Staff Chat — Stage 3 (private API and chats page) Implementation Plan

**Goal:** give signed-in workspace members a private Staff Chat interface over
the Stage 1 service and Stage 2 public surface: chat list, direct-message
thread, attachments, read state, presence, and support/trial-safe read-only
behaviour. Realtime and chat notifications are explicitly Stage 4.

**Spec:** `docs/superpowers/specs/2026-10-27-staff-chat-design.md`, sections
4.1–4.3, 4.6–4.7, 5, 8–10 and decisions D2, D4, D5, D8. Prerequisites are
implemented in commits `efd426081`, `58d484391`, `599cc47c8`, and
`481b17f14`.

## Constraints

- No migration and no public API operation: Stage 2 already exposes the
  token-facing API. `markRead`, presence polling and local UI state are
  personal/session-only UI plumbing, an invariant-23 exemption.
- Private handlers use `authorizedAPI` plus
  `workspaceAuthorizedMidddleware` (three `d`s) and call `chatService`; they
  never import `db`.
- A normal session uses `{ kind: "member", userId }`. A support session is
  the only private caller allowed `{ kind: "workspace" }`; its writes must be
  rejected in the handler and its `markRead` is a no-op.
- Add the private mark-read path to `READ_ONLY_POST_PATHS` so an expired trial
  can clear its personal unread state. GET and DELETE retain existing trial
  semantics; open/send/edit/upload remain blocked by the standard method gate.
- Reuse shared task feed pieces only after making them domain-neutral. Chats
  must not parse or render `@` mentions, and their editor sends on Enter while
  Shift+Enter inserts a line break.
- All user-visible strings go through `useTranslations()` and land in all 22
  locale files (English for non-`en`/`ru` locales), with the Russian fixture
  updated where required. Mutations invalidate `orpc.chatsAPI.key()`.
- Local verification follows the existing Staff Chat constraints: focused
  Vitest and `npx ultracite check|fix <paths>`; type checks and broad suites
  run in CI.

## Task 1 — Private router, schemas, and access rules

**Files:** create `apps/builder/src/features/chats/api/{index.ts,private.ts}`,
`schema/private.ts`, `lib/{api-paths.ts,session.ts}` and
`hooks/use-invalidate-chats.ts`; modify `apps/builder/src/routers/index.ts`,
`apps/builder/src/lib/workspace/authorize-workspace-access.ts`, and focused
builder tests.

1. Define private response schemas by extending the existing public resource
   schemas directly (not through generic Zod wrappers): expose `unreadCount`
   and `peerLastReadAt` only to the signed-in caller. Define inputs for list,
   get, open, paged messages (`beforeId` cursor), send/edit/delete/upload,
   `markRead({ upToMessageId? })`, `unreadTotal`, and presence.
2. Mount `chatsAPI` only in the private router. Handlers resolve the current
   user and workspace access from middleware context, then converge on the
   existing `chatService` methods. Use the builder URL/attachment helpers in
   every response containing chats or messages.
3. Reject all support-session writes before calling the service. For support
   reads use workspace scope; for members use member scope. `markRead` returns
   `{ changed: false }` for support sessions and otherwise calls
   `chatService.markRead`, passing `upToMessageId` when supplied.
4. Add a namespaced, literal private mark-read path constant to the
   read-only POST allow-list; test that an expired workspace may mark chat
   read but not open/send/upload.
5. Test private/public convergence, participant isolation, support's
   workspace-wide read-only access, removed-peer reads and write rejection,
   `upToMessageId` validation, unread total, and attachment URL shaping.

## Task 2 — Shared thread presentation primitives

**Files:** create `apps/builder/src/features/internal-thread/components/` for
the domain-neutral editor, composer, attachment display, and message-item
primitives; modify the task feed imports only as needed to preserve its
current mention-aware behaviour; add narrow component tests.

1. Extract the reusable attachment picker/upload queue, selected-file list,
   attachment renderer and edit/delete shell from Tasks behind explicit
   adapters (`uploadAttachment`, `createMessage`, `updateMessage`,
   `deleteMessage`, permissions, labels).
2. Keep Tasks' `MentionEditor` and task mutation contracts intact. Add a
   plain TipTap editor for Chats: no mention extension, Enter submits and
   Shift+Enter inserts a newline; retain keyboard and screen-reader affordances.
3. Preserve 10-file / 25-MB client-side guardrails, server-side enforcement,
   no send during upload, image previews, safe download links and all existing
   invalidation points.
4. Test the chat editor keyboard behaviour and adapter calls; run the existing
   task comment component tests so extraction cannot regress task Stage 3.

## Task 3 — Chats page and navigation

**Files:** create `apps/builder/src/app/space/[workspaceId]/chats/{page.tsx,[threadId]/page.tsx}` and
`apps/builder/src/features/chats/components/` (page shell, list, thread,
composer, new-chat picker, unread badge); modify `app-sidebar.tsx`, relevant
layout/query components, locale files, and builder tests.

1. Add an always-visible `MessagesSquareIcon` navigation item adjacent to
Tasks. Its private `unreadTotal` query renders an accessible `99+` badge.
2. Implement desktop split-pane and narrow-screen one-panel navigation. The
list reads page one of chats, resolves peer identity from members, displays
title for agent chats, last-message state, unread count, selection, and an
online dot from a 20-second presence query while this page is active.
3. Build the "New chat" picker from current workspace members: exclude the
viewer, search by name, show presence, call `chatsAPI.open`, then navigate to
the returned thread. Empty chats remain hidden from the list but the new URL
opens them directly.
4. Build the thread UI: newest messages at bottom; load older messages using
`beforeId` when scrolling upward; day dividers and five-minute author groups;
auto-scroll only when already at the bottom. Render author labels/API badges,
edited/deleted state, attachments, own-message edit/delete affordances and
the direct peer's read marker. Do not render a peer-read marker for agent
chats.
5. When the tab is visible, mark the newest loaded message read at most once
every two seconds. On success invalidate chat queries; never call it for a
support session.
6. A removed peer leaves the thread readable but replaces the composer with a
localized notice. A support session sees a clear read-only banner, all chats
in workspace scope, and no mutation/new-chat controls. An expired trial hides
open/send/edit/upload controls but preserves reads and deletion allowed by the
server.
7. Add i18n in every locale, `ru-same-as-english` updates, and focused tests
for navigation visibility, support/trial controls, member picker exclusions,
read throttling, and key message states.

## Task 4 — Verification and handoff

1. Add all new test files to `.github/workflows/gkamion-checks.yml` in the
builder job. Run focused builder tests and `npx ultracite check` on changed
paths; run the unchanged task comment tests after extraction.
2. Confirm no new app-layer `db` imports, no dynamic imports, no hardcoded
UI text, and no private procedure accidentally registered in `publicRouter`.
3. Run `pnpm lint` and builder type checks in CI as required by the existing
Staff Chat plan. Do not run a migration.
4. Commit as `feat(chat): add private staff chat UI and read state`.

## Out of scope / handoff to Stage 4

- `staffChats` PartyKit topic, `chatChanged`, realtime query invalidation.
- `chatMessage` notification delivery, notification preference toggle and
  bell rendering.
- Hermes picker, typing state and settings (Stage 6); message-to-task action
  (Stage 5).

## Acceptance criteria

- A member can open a one-to-one chat, upload/send/edit/delete own messages,
  view read status and clear unread state entirely through the private UI.
- A support session can read every chat in the workspace but cannot create,
  mutate, upload, mark read or become a chat participant.
- A removed peer and expired trial fail safely without leaving stale mutation
  controls; attachment access remains scoped to the message/workspace.
- No Stage-4 realtime or notification behaviour is introduced early.
