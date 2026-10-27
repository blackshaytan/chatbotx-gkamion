# Staff Chat — Stage 2 (public API and agent access) Implementation Plan

**Goal:** expose the Stage 1 staff-chat service to workspace API tokens, CLI,
and MCP without exposing private employee conversations to legacy unrestricted
tokens. This stage adds no chat UI, notifications, or realtime delivery.

**Spec:** `docs/superpowers/specs/2026-10-27-staff-chat-design.md`, sections
4.7, 6, 8–10 and decision D6. Stage 1 is implemented in commits `efd426081`,
`58d484391`, and `599cc47c8`.

## Confirmed product decisions

1. `chats` is an **explicit-only** token permission. Unlike existing scopes,
   `scopes: null` does not grant it; the token must contain `"chats"`.
2. A one-off, approved data step updates only the workspace default token to
   an explicit list of every current scope plus `"chats"`, so it retains its
   existing access. Hermes is updated in Stage 6, when its API-token link
   exists and can be selected safely.
3. The nine API operations are searchable MCP/CLI operations, but none is in
   the MCP default set.

## Constraints

- Follow `handler → service → repository → DB`; public and private handlers
  call the same `chatService` methods.
- No direct database access in `apps/builder` and no dynamic imports.
- Every public operation uses `workspaceTokenAuthAPIForScope("chats")` and
  describes where its input IDs come from.
- `read_only` workspace tokens remain limited to GET/HEAD. All chat writes,
  including file upload, use non-GET methods.
- A signed chat attachment URL lasts one hour and authorizes access only to
  its exact workspace/message/index. Bad token, wrong kind, missing/deleted
  message, foreign workspace, or foreign chat returns 404.
- Run `cli-mcp-docs` as the final API step. Do not apply a database migration:
  Stage 2 needs no schema migration.

## Task 1 — Explicit `chats` token scope

1. Add `"chats"` to `workspaceApiTokenScopes` in
   `packages/database/src/partials/workspace-api-token.ts` and register it in
   `apps/builder/src/features/workspaces/lib/workspace-token-scopes.ts` with
   the next stable display order and an i18n key.
2. Add all locale strings for the scope checkbox and privacy warning. The
   warning must say in plain language that this key can read all employee
   one-to-one and API-agent chats in the workspace.
3. Extend `requireTokenScope` in `apps/builder/src/orpc.ts` with an
   explicit-only option, used only by `workspaceTokenAuthAPIForScope("chats")`:
   missing scope, empty scopes, and `scopes: null` are all denied for chats;
   existing scopes retain their current null-means-all behavior.
4. Make the token create/edit UI treat `chats` as opt-in: it is not included
   by the existing “all scopes” preset. A `scopes: null` token displays Chats
   unchecked with guidance to create/edit a token with an explicit list.
5. Add focused tests for the scope registry, UI selection, and middleware:
   `null` denies chats, an explicit list containing chats passes, an explicit
   list without chats denies, and unrelated scopes keep their old behavior.

## Task 2 — Public chat router and schemas

Create `apps/builder/src/features/chats/` using the task feature as the API
shape reference.

1. Add zod public schemas for chat, member, message, attachment, pagination,
   path parameters, and multipart upload. Public chat/message responses include
   UI URLs and signed attachment URLs, but omit read state (`unreadCount`,
   `peerLastReadAt`) because it belongs to a signed-in employee session.
2. Add `api/public.ts`, mount it as `chats` in `routers/public.ts`, and use
   `workspaceTokenAuthAPIForScope("chats")` for all procedures:

   | Operation | HTTP route | Service call |
   |---|---|---|
   | `list` | `GET /v1/chats` | `chatService.list` with workspace scope and optional participant filter |
   | `get` | `GET /v1/chats/{id}` | `chatService.get` with workspace scope |
   | `open` | `POST /v1/chats/open` | `chatService.open` |
   | `messages.list` | `GET /v1/chats/{id}/messages` | `chatService.listMessages` with workspace scope |
   | `messages.create` | `POST /v1/chats/{id}/messages` | `chatService.send` with API-token actor |
   | `messages.update` | `PATCH /v1/chats/{id}/messages/{messageId}` | `chatService.edit` with API-token actor |
   | `messages.delete` | `DELETE /v1/chats/{id}/messages/{messageId}` | `chatService.deleteMessage` with API-token actor |
   | `attachments.upload` | `POST /v1/chats/{id}/attachments` | `chatService.uploadAttachment` with API-token actor |
   | `presence` | `GET /v1/chats/presence` | existing workspace-presence service |

3. Add builder-layer URL helpers modelled on
   `features/tasks/lib/{task-url,attachment-url}.ts`; helpers call
   `resolveTenantSettings`, issue 1-hour `chatAttachment` media tokens, and
   map all message attachment views without duplicating business logic.
4. Set clear OpenAPI summaries/descriptions. Every ID explains its source:
   chat IDs from `chats.list`/`chats.open`, message IDs from
   `chats.messages.list`, users from `workspaceMembers.list`, and attachment
   keys from `chats.attachments.upload`. State that mentions are unsupported.
   Do not assign `visibility: "default"` to any route.
5. Add route and scope tests: generated operation IDs/descriptions, exact
   response shape, token author label/anonymous user ID, other-workspace 404,
   `read_only` rejection of all write routes, and explicit scope enforcement.

## Task 3 — Signed chat attachment route

1. Add the `chatAttachment` kind to
   `packages/encryption/src/media-token.ts` and its focused unit test before
   using it in the builder. It must retain the existing signed token claims
   (`workspaceId`, kind, and reference ID).
2. Add `app/media/chat-attachment/[token]/route.ts` modelled on the task
   attachment route. Resolve only `chatAttachment`, parse `<messageId>:<index>`,
   call `chatService.findAttachment`, fetch with the filesystem uploader, and
   return the existing private-download headers.
3. Register `/media/chat-attachment` in the proxy public-route list and add
   the proxy regression test.
4. Add route tests for valid download and every 404 case: malformed or wrong
   token kind, cross-workspace token, invalid index, missing object, deleted
   message, task-thread message, and chat message outside the permitted
   workspace.

## Task 4 — Support-session context preparation (no UI/API)

1. Make the existing workspace access context expose `isSupportSession` where
   Stage 3's private chats API will need it. Do not create
   `features/chats/api/private.ts`, private chat procedures, or UI in this
   stage.
2. Add a focused context/middleware test proving the support-session flag is
   preserved. Stage 3 will use it to select workspace-wide, read-only chat
   access; `chatService` must not infer support status itself.

## Task 5 — Documentation, token data step, and verification

1. Update `docs/developer/workspace-api-tokens.md` with the special explicit
   Chats rule and the privacy warning. Add `docs/staff-chat.md` describing
   public chat operations, API-token authorship, agent polling, attachment
   links, and the fact that chats are not default MCP tools.
   Update the public `token.get` description and its test so “all scopes” no
   longer claims automatic access to Chats; the response must make the
   explicit Chats exception clear to an agent.
2. Implement a deliberately invoked admin/maintenance data step (not a schema
   migration) that converts only the default token from null scopes to the
   full current scope list plus `chats`. It must be idempotent, report changed
   token IDs/counts, and have a dry-run mode. Run it only after an explicit
   production approval. Hermes is intentionally excluded until Stage 6 adds a
   reliable API-token link.
3. Run the `cli-mcp-docs` checklist: public-spec operation and MCP tests,
   CLI collision check for the `chats` group, CLI/MCP docs updates where the
   generated surface requires them, and a live refresh-spec check.
4. Verify with focused builder/business tests, formatting, typechecks for
   touched workspaces, and `pnpm lint`. Run `invariant-guard` before handoff.

## Acceptance criteria

- A token with `scopes: null` receives 403 for every `chats.*` procedure;
  an explicit `chats` token succeeds within its workspace.
- An agent can open a direct or agent chat, upload an attachment, send/read,
  edit its own message, delete a message, and read presence using only the
  public spec.
- No chat procedure appears in MCP’s default tool set; it is discoverable via
  search tools and has unambiguous operation IDs.
- Signed attachment URLs cannot disclose another workspace’s files.
- The support-session marker is ready for Stage 3 without adding private chat
  APIs prematurely.
- The approved data step preserves default-token capability while making
  `chats` explicit; Hermes is deferred to Stage 6.
