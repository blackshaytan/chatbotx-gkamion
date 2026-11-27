# Manager email signatures (SMTP inbox replies)

**Date:** 2026-11-25  
**Status:** Approved for implementation (product choices locked with owner)  
**Scope:** Per-manager plain-text email signature, appended only to manual inbox replies on SMTP.

## Problem

When a workspace manager replies to a client from the ChatbotX inbox over Email (SMTP), the outgoing mail has no personal footer. Managers want individual signatures (name, phone, title) without typing them every time.

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Which sends get a signature | **Only manual inbox replies** from a manager (`senderType = user`) on an SMTP channel |
| Format | **Plain text** only (multi-line string) |
| Storage | **`WorkspaceMember.emailSignature`** — one signature per membership (per workspace) |
| Who can edit | Manager edits own; workspace admin / super-admin can edit any member’s |

Out of scope for this release:

- HTML / rich editor signatures  
- Flow steps, broadcasts, public API sends, bot / Hermes / trigger messages  
- User-global signature shared across all workspaces  
- Prefix-style chat signatures (`signMessages` on the external agent) — unchanged

## Design

### 1. Data model

Add nullable column on `WorkspaceMember`:

- `emailSignature` — `text`, nullable  
- Application max length: **4000** characters (Zod + UI); blank / whitespace-only treated as unset  
- No default; existing rows stay `NULL` (no signature)

Migration: generate via drizzle (`make:migration`), inspect SQL, **do not apply** until the owner explicitly approves `db:migrate` (AGENTS.md).

Relations / repositories: extend `WorkspaceMember` select/update paths used by member get/list/update so the field round-trips. Explicit write on insert/update when provided (no reliance on a drizzle `.default()` for this column).

### 2. Append behaviour (worker / SMTP outbound)

**Where:** After the outgoing manager message text is resolved for channel send (near existing sender-signature handling in `apps/worker/src/chat/handlers/send-message.ts` / SMTP path), **before** `integrations/smtp` `sendMail`. Prefer a small pure helper (e.g. `appendEmailSignature(text, signature)`) so unit tests do not need the full send pipeline.

**When all of the following are true:**

1. Channel is `smtp`  
2. Message `senderType` is `user` (manager)  
3. Message has non-empty text (same spirit as `isSignableMessage` — no signature-only send for empty/attachment-only)  
4. Membership for `(workspaceId, senderId)` has a non-blank `emailSignature`

**When not to append:** flow / bot / AI / API / comment / template payloads; empty signature; non-SMTP channels.

**Format:**

```
{body}

--
{emailSignature}
```

- Exactly one blank line before `--`, then signature lines unchanged (preserve manager’s line breaks).  
- If body already ends with the same separator+signature, do not double-append (idempotent for retries).  
- For SMTP HTML (`textToHtml`), run on the **final** text (body + signature) so the footer appears in both `text` and `html` parts.  
- **Stored inbox message** keeps the original body **without** the signature (same pattern as external-agent `signMessages`: channel copy only). Document this so managers know the transcript stays clean.

**Lookup:** `workspaceMember` by `workspaceId` + `userId = message.senderId`. Missing membership → send unsigned (log warn, never throw).

### 3. UI (builder)

1. **Own signature** — settings surface for the current membership (workspace member settings / profile-in-workspace). Label via i18n, e.g. “Email signature”, helper that it applies only to manual Email replies. `Textarea`, max 4000.  
2. **Admin edit** — extend `update-workspace-member` form with the same field so an admin can set another member’s signature.  
3. All copy through `useTranslations()`; keys in **all** locale files under `apps/builder/messages/` (parity with `en.json`). Prefer reusing `fields.*` where possible.

No change to the compose box UX beyond optional hint; signature is automatic on send.

### 4. Public API (agent-first)

Today `workspaceMembers` public router is read-only (`list` / `get`). Add:

- **`workspaceMembers.update`** — `PATCH /v1/members/{memberId}` (or existing private mutate path mirrored publicly) accepting optional `emailSignature` (`string | null`; empty string → `null`).  
- Scope: same as other member mutations (likely `inbox` or a members-appropriate scope already used by private update — match private auth).  
- Extend `list` / `get` response resources with `emailSignature` (nullable string).  
- Summary/description: how to obtain `memberId` (`workspaceMembers.list`).  
- Run **cli-mcp-docs** after the public surface change.

Exempt only if product later decides signatures are personal-account-only; **not** exempt here — workspace token must be able to set them for agents.

Private server action `updateWorkspaceMember` gains the same field; self-update path allows a member to change **only** their own `emailSignature` without needing full admin permission (admin still required to change others’ permissions as today).

### 5. Permissions

| Actor | Own signature | Other member’s signature |
| --- | --- | --- |
| Member | Update | No |
| Workspace admin / `permissions.superAdmin` | Update | Update |
| Support session | Follow existing support-access rules; must not widen via synthetic membership beyond current patterns |

### 6. Testing

- Unit: `appendEmailSignature` (empty, multiline, idempotent, max length trim/reject at schema).  
- Unit/integration: SMTP outbound manager path appends; flow/bot path does not; stored message unchanged.  
- Action/API: self update vs admin update; public get returns field.  
- i18n parity check via builder lint.

### 7. Deploy notes (GKamion)

- Needs **builder** (UI + API) and **worker** (append on send) images.  
- Migration apply only after explicit owner approval.  
- Pin images via GHCR workflow; do not reinvent local `next build` on the VPS.

## Non-goals / follow-ups

- HTML signatures and logo blocks  
- Per-inbox signature override  
- Auto-insert into compose as editable draft (vs channel-only append)  
- Syncing with external-agent name prefix

## Success criteria

1. Manager sets a plain-text signature for workspace W.  
2. Manual SMTP reply from that manager to a client includes the footer; transcript in ChatbotX does not.  
3. Flow email / broadcast / bot send has no footer.  
4. Admin can set another member’s signature; member cannot set others’.  
5. CLI/MCP can read and update via public members API.
