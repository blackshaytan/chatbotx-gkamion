# SMTP Mailbox Ownership — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Execute task by task; each task goes Coder → Reviewer → Tester (max 3 rounds), then the next task. Steps use `- [ ]`.

**Spec:** `docs/plans/2026-11-26-smtp-mailbox-ownership-design.md` (approved 2026-11-26). The spec wins over this plan if they disagree.

**Goal:** An SMTP inbox can be personal (`Inbox.ownerUserId`). Members other than the owner and `superAdmin` don't see its messages in the UI. Auto-assign the owner, send pushes to owner + admins, target realtime to them, and keep personal SMTP out of broadcasts.

**Architecture:**
- Precompute `hiddenInboxIds` per member request in `@chatbotx.io/business`.
- Apply it in SQL: a relational `notIn` on `contactInboxes` for conversations; `excludeContactInboxIds` for the sharded message tables.
- Workspace tokens never get the filter.

**Tech stack:** Drizzle (relational v2 `where` objects), sharded message repository, oRPC, next-safe-action, BullMQ worker, partysocket realtime, vitest.

## Global constraints

- Chain: action / API handler → service (`packages/business`) → repository → DB. **No `db` import in `apps/` or `integrations/`.** New raw queries go in `packages/database/src/repositories/...`.
- No dynamic `import()` in `packages/*`, `apps/worker`.
- Every user-facing string goes through `useTranslations()`. Add the key to `apps/builder/messages/en.json` **and** `ru.json`; run `pnpm --filter builder i18n:check`.
- Logger key is `err`, never `error`.
- Middleware names use three d's: `workspaceAuthorizedMidddleware`, `workspaceTokenAuthMidddleware`.
- `bindArgsSchemas` actions are called via `.bind(null, …)`.
- TanStack Query mutations must invalidate (the SMTP forms already invalidate inboxes; keep it).
- **Migration:** generate and inspect only. `db:migrate` waits for explicit owner approval.
- **This machine is production:** run targeted `vitest run <file>` only, never the full suite. Run `pnpm lint` and `check-types` per touched package at the end.
- Commits: `<type>(<scope>): <subject>`, stage specific files only, never `git add -A`.
- Members without access get **not found**, never a distinct "forbidden mailbox" error.

## Subagent roles and models

| Stage | Role | Model | Responsibility |
| --- | --- | --- | --- |
| 1 | Orchestrator | current session | Dispatch tasks, keep TODO list, pass only the essence of failures |
| 2 | **Coder** | Haiku 5.5 (`claude-haiku-5-5-thinking-high`) | Implement one task exactly as written. TDD: test first, then code. |
| 3 | **Reviewer** | DeepSeek V4.1 Flash (`deepseek-v41-flash-1017-high`) + `invariant-guard` subagent | Review the diff **before** tests: bugs, leaks, invariants, spec drift |
| 4 | **Tester** | Gemini 3.8 Flash (`gemini-3.8-flash-high`) | Run the task's commands; add missing edge tests; return the failure essence only |
| 5 | **Validator** | Claude Sonnet 5.5 (`claude-sonnet-5-5-high`) | After all tasks: compare against spec T1–T18, list what passed |

The workspace rule names GLM 5.3 as Coder, which is not available in this session. The user rule (Haiku 5.5) is used.

**Loop per task:** Coder → Reviewer → (fixes by Coder) → Tester → if red, back to Coder with the essence of the log. Max 3 rounds, then stop and report.

### Standard Reviewer checklist (applies to every task)

1. No `db` import in `apps/*`; new SQL only in repositories.
2. Token paths (`workspaceTokenAuthAPIForScope`) never receive `hiddenInboxIds`.
3. Member paths always pass `hiddenInboxIds` (search callers: no path forgotten).
4. Hidden data → `notFoundException`, same message as a missing resource.
5. Empty `hiddenInboxIds` / `excludeContactInboxIds` → no SQL predicate added (no `NOT IN ()`).
6. No user-facing literal strings; i18n keys exist in en + ru.
7. Logger uses `{ err }`.
8. The diff matches the task scope; no unrelated refactors.
9. Run the `invariant-guard` subagent on the diff; report its violations.

### Standard Tester procedure

1. Run the exact commands listed in the task.
2. If a spec case for the task has no test, add one in the task's test file.
3. Report a table: test → pass/fail. On failure, the first relevant assertion plus 5 lines of stack only.

---

## Task 0: Isolated worktree (Orchestrator)

The main checkout has unrelated uncommitted builder edits in files this plan touches (`conversations/api/private.ts`, `get-inbox-initial-state.query.ts`, `inbox/page.tsx`).

- [ ] **Step 1:** Create the worktree from the current HEAD:

```bash
cd /GKamion/chatbotX
git worktree add ../chatbotX-smtp-owner -b feat/smtp-mailbox-ownership HEAD
cd ../chatbotX-smtp-owner && CI=true pnpm install --frozen-lockfile
```

- [ ] **Step 2:** All tasks run inside `/GKamion/chatbotX-smtp-owner`. Expected: `git status` is clean.

---

## Task 1: Schema `Inbox.ownerUserId` + migration (Wave 1)

**Files:**
- Modify: `packages/database/src/schema/inbox.ts`
- Modify: `packages/database/src/relations/inbox.ts`
- Create: `packages/database/drizzle/<timestamp>_inbox_owner_user/migration.sql` (generated)

**Produces:** `inboxModel.ownerUserId: string | null`; relation `ownerUser`; `InboxModel` gains `ownerUserId`.

### Coder

- [ ] **Step 1: Column + index** in `inbox.ts`. Add the import `import { userModel } from "./auth-user"`. Then:

```ts
    threadControlSeenAt: timestamp(timestampConfig),
    // Personal SMTP mailbox owner. null = shared. Only set when channel = smtp.
    ownerUserId: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    // …existing indexes…
    index("Inbox_workspaceId_ownerUserId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
      table.ownerUserId.asc().nullsLast(),
    ),
  ],
```

- [ ] **Step 2: Relation** in `relations/inbox.ts`, inside `inbox: { … }`, following `conversation.assignedUser`:

```ts
    ownerUser: r.one.userModel({
      from: r.inboxModel.ownerUserId,
      to: r.userModel.id,
      optional: true,
    }),
```

`relations/index.ts` already imports and spreads `inboxRelations` — no edit there.

- [ ] **Step 3: Generate the migration** (never apply):

```bash
pnpm --filter @chatbotx.io/database make:migration inbox_owner_user
```

Expected SQL (inspect it):
- `ALTER TABLE "Inbox" ADD COLUMN "ownerUserId" bigint;`
- an FK to `"User"("id")` with `ON DELETE set null ON UPDATE cascade`
- `CREATE INDEX "Inbox_workspaceId_ownerUserId_idx" …`

Nothing else.

- [ ] **Step 4:** `pnpm --filter @chatbotx.io/database db:check-drift`. Expected: no drift.

### Reviewer (extra)
- The SQL contains only the column, FK and index. No default and no NOT NULL.
- Nothing calls `db:migrate`.

### Tester

```bash
pnpm --filter @chatbotx.io/database db:check-drift
pnpm --filter @chatbotx.io/database check-types
```

- [ ] **Commit:** `feat(database): add Inbox.ownerUserId for personal smtp mailboxes` (stage schema, relation and the generated migration folder only).

**Orchestrator gate:** show the migration SQL to the owner and wait for approval of `db:migrate` before deploying (code tasks can continue).

---

## Task 2: Business ownership service (Wave 1)

**Files:**
- Modify: `packages/database/src/repositories/inbox/repository.ts`
- Create: `packages/business/src/inbox/smtp-ownership.ts`
- Modify: `packages/business/src/inbox/index.ts` (export)
- Modify: `packages/business/src/workspace-member/service.ts` (`delete`)
- Test: `packages/business/src/inbox/__tests__/smtp-ownership.test.ts`
- Test: `packages/business/__tests__/workspace-member-delete-clears-inbox-owner.test.ts`

**Produces** (used by every later task):

```ts
// packages/business/src/inbox/smtp-ownership.ts
export type SmtpViewer = { userId: string; permissions: PermissionsInput }

export const smtpOwnershipService: {
  /** Personal SMTP inbox ids the member must not see. [] for superAdmin. */
  listHiddenInboxIdsForMember(input: {
    workspaceId: string
    viewer: SmtpViewer
  }): Promise<string[]>
  /** owner ∪ workspace admins (owner role or superAdmin), deduped. null if inbox is shared/non-smtp. */
  resolveAudienceUserIds(input: {
    workspaceId: string
    inboxId: string
  }): Promise<string[] | null>
  /** Validates and writes ownerUserId; throws ChatbotXException 400 on invalid. */
  setOwner(input: {
    workspaceId: string
    inboxId: string
    ownerUserId: string | null
    tx?: DatabaseClient
  }): Promise<void>
  clearOwnerForUser(input: {
    workspaceId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<void>
}

/** ContactInbox ids whose inbox is hidden. Pure. */
export const hiddenContactInboxIds = (
  contactInboxes: readonly { id: string; inboxId: string }[],
  hiddenInboxIds: readonly string[] | undefined,
): string[]
```

### Coder

- [ ] **Step 1: Failing tests** `smtp-ownership.test.ts` (mock `@chatbotx.io/database/repositories/inbox` and `workspaceMemberService`, following `resolve-broadcast-inbox-ids.test.ts`):

```ts
describe("listHiddenInboxIdsForMember", () => {
  test("superAdmin sees everything", async () => {
    expect(await smtpOwnershipService.listHiddenInboxIdsForMember({
      workspaceId: "w1",
      viewer: { userId: "u2", permissions: { superAdmin: true } },
    })).toEqual([])
    expect(repo.listPersonalSmtpInboxes).not.toHaveBeenCalled()
  })
  test("agent sees own personal inbox, not others", async () => {
    repo.listPersonalSmtpInboxes.mockResolvedValue([
      { id: "i1", ownerUserId: "u1" }, { id: "i2", ownerUserId: "u2" },
    ])
    expect(await smtpOwnershipService.listHiddenInboxIdsForMember({
      workspaceId: "w1",
      viewer: { userId: "u2", permissions: { superAdmin: false } },
    })).toEqual(["i1"])
  })
})
describe("hiddenContactInboxIds", () => {
  test("maps hidden inbox ids to contact inbox ids", () => {
    expect(hiddenContactInboxIds(
      [{ id: "ci1", inboxId: "i1" }, { id: "ci2", inboxId: "i9" }], ["i1"],
    )).toEqual(["ci1"])
    expect(hiddenContactInboxIds([{ id: "ci1", inboxId: "i1" }], undefined)).toEqual([])
  })
})
describe("resolveAudienceUserIds", () => {
  test("shared inbox → null", async () => {
    repo.findById.mockResolvedValue({ id: "i1", workspaceId: "w1", channel: "smtp", ownerUserId: null })
    expect(await smtpOwnershipService.resolveAudienceUserIds({ workspaceId: "w1", inboxId: "i1" })).toBeNull()
  })
  test("personal → owner + admins, deduped", async () => {
    repo.findById.mockResolvedValue({ id: "i1", workspaceId: "w1", channel: "smtp", ownerUserId: "u1" })
    members.listByWorkspaceId.mockResolvedValue([
      { userId: "u1", role: "agent", permissions: { superAdmin: true } },
      { userId: "u3", role: "owner", permissions: {} },
      { userId: "u4", role: "agent", permissions: { superAdmin: false } },
    ])
    expect(await smtpOwnershipService.resolveAudienceUserIds({ workspaceId: "w1", inboxId: "i1" }))
      .toEqual(["u1", "u3"])
  })
})
describe("setOwner", () => {
  test("rejects non-smtp inbox", async () => {
    repo.findById.mockResolvedValue({ id: "i1", workspaceId: "w1", channel: "whatsapp", ownerUserId: null })
    await expect(smtpOwnershipService.setOwner({ workspaceId: "w1", inboxId: "i1", ownerUserId: "u1" }))
      .rejects.toMatchObject({ code: "smtpOwnerInvalidChannel" })
  })
  test("rejects non-member owner", async () => {
    repo.findById.mockResolvedValue({ id: "i1", workspaceId: "w1", channel: "smtp", ownerUserId: null })
    members.findMembership.mockResolvedValue(undefined)
    await expect(smtpOwnershipService.setOwner({ workspaceId: "w1", inboxId: "i1", ownerUserId: "u9" }))
      .rejects.toMatchObject({ code: "smtpOwnerNotMember" })
  })
  test("null clears without member lookup", async () => {
    repo.findById.mockResolvedValue({ id: "i1", workspaceId: "w1", channel: "smtp", ownerUserId: "u1" })
    await smtpOwnershipService.setOwner({ workspaceId: "w1", inboxId: "i1", ownerUserId: null })
    expect(repo.updateOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: null }))
  })
})
```

- [ ] **Step 2:** Run → FAIL (module missing):
  `pnpm --filter @chatbotx.io/business exec vitest run src/inbox/__tests__/smtp-ownership.test.ts`

- [ ] **Step 3: Repository** — add to `inboxRepository`. The imports need `and, eq, isNotNull` from `../../client`.

```ts
  async listPersonalSmtpInboxes(input: { workspaceId: string; tx?: DatabaseClient }) {
    const { tx = db } = input
    return await tx.query.inboxModel.findMany({
      columns: { id: true, ownerUserId: true },
      where: { workspaceId: input.workspaceId, channel: "smtp", ownerUserId: { isNotNull: true } },
    })
  },

  async updateOwner(input: {
    workspaceId: string; inboxId: string; ownerUserId: string | null; tx?: DatabaseClient
  }): Promise<void> {
    const { tx = db } = input
    await tx.update(inboxModel).set({ ownerUserId: input.ownerUserId })
      .where(and(eq(inboxModel.id, input.inboxId), eq(inboxModel.workspaceId, input.workspaceId)))
  },

  async clearOwnerForUser(input: { workspaceId: string; userId: string; tx?: DatabaseClient }) {
    const { tx = db } = input
    await tx.update(inboxModel).set({ ownerUserId: null })
      .where(and(eq(inboxModel.workspaceId, input.workspaceId), eq(inboxModel.ownerUserId, input.userId)))
  },
```

- [ ] **Step 4: Service** `smtp-ownership.ts`:

```ts
import { inboxRepository } from "@chatbotx.io/database/repositories/inbox"
import type { DatabaseClient } from "@chatbotx.io/database/client"
import { channelTypes } from "@chatbotx.io/utils/channel"
import { ChatbotXException } from "../errors"
import { hasWorkspacePermission, type PermissionsInput } from "../workspace-member/permissions"
import { isWorkspaceAdminMember } from "../workspace-member/predicates"
import { workspaceMemberService } from "../workspace-member/service"

export type SmtpViewer = { userId: string; permissions: PermissionsInput }

export const hiddenContactInboxIds = (
  contactInboxes: readonly { id: string; inboxId: string }[],
  hiddenInboxIds: readonly string[] | undefined,
): string[] => {
  if (!hiddenInboxIds?.length) return []
  const hidden = new Set(hiddenInboxIds)
  return contactInboxes.filter((ci) => hidden.has(ci.inboxId)).map((ci) => ci.id)
}

export const smtpOwnershipService = {
  async listHiddenInboxIdsForMember({ workspaceId, viewer }: { workspaceId: string; viewer: SmtpViewer }) {
    if (hasWorkspacePermission(viewer.permissions, "superAdmin")) return []
    const personal = await inboxRepository.listPersonalSmtpInboxes({ workspaceId })
    return personal.filter((inbox) => inbox.ownerUserId !== viewer.userId).map((inbox) => inbox.id)
  },

  async resolveAudienceUserIds({ workspaceId, inboxId }: { workspaceId: string; inboxId: string }) {
    const inbox = await inboxRepository.findById({ id: inboxId })
    if (!inbox || inbox.workspaceId !== workspaceId) return null
    if (inbox.channel !== channelTypes.enum.smtp || !inbox.ownerUserId) return null
    const members = await workspaceMemberService.listByWorkspaceId({ workspaceId })
    const admins = members.filter((member) => isWorkspaceAdminMember(member)).map((member) => member.userId)
    return Array.from(new Set([inbox.ownerUserId, ...admins]))
  },

  async setOwner({ workspaceId, inboxId, ownerUserId, tx }: {
    workspaceId: string; inboxId: string; ownerUserId: string | null; tx?: DatabaseClient
  }) {
    const inbox = await inboxRepository.findById({ id: inboxId, tx })
    if (!inbox || inbox.workspaceId !== workspaceId) {
      throw new ChatbotXException("Inbox not found", "smtpOwnerInboxNotFound", 404)
    }
    if (ownerUserId !== null) {
      if (inbox.channel !== channelTypes.enum.smtp) {
        throw new ChatbotXException("Only SMTP inboxes can have an owner", "smtpOwnerInvalidChannel", 400)
      }
      const member = await workspaceMemberService.findMembership({ workspaceId, userId: ownerUserId })
      if (!member) {
        throw new ChatbotXException("Owner must be a workspace member", "smtpOwnerNotMember", 400)
      }
    }
    await inboxRepository.updateOwner({ workspaceId, inboxId, ownerUserId, tx })
  },

  async clearOwnerForUser(input: { workspaceId: string; userId: string; tx?: DatabaseClient }) {
    await inboxRepository.clearOwnerForUser(input)
  },
}
```

Check the exact names before use:
- the `ChatbotXException` import path inside business (grep `class ChatbotXException`);
- the `findMembership` signature (grep in `workspace-member/service.ts`);
- the repository subpath export (`packages/database/package.json` exports).

Adjust the imports to the real paths; do not invent new exports.

- [ ] **Step 5:** Export from `packages/business/src/inbox/index.ts`: `export * from "./smtp-ownership"`.

- [ ] **Step 6: Member delete hook.** In `workspaceMemberService.delete` → `removeMember`, after the `delete(workspaceMemberModel)` and inside `if (found)`:

```ts
        await smtpOwnershipService.clearOwnerForUser({ workspaceId, userId: found.userId, tx })
```

Watch for circular imports: if `inbox/smtp-ownership.ts` → `workspace-member/service.ts` creates a cycle, call `inboxRepository.clearOwnerForUser` directly here instead. Verify with `pnpm check:circular`.

- [ ] **Step 7: Delete-hook test** `workspace-member-delete-clears-inbox-owner.test.ts`: mock the transaction and repository. Deleting member u1 calls `clearOwnerForUser({ workspaceId: "w1", userId: "u1", tx })`. Mirror the mocking style of the existing workspace-member service tests (grep `workspaceMemberService.delete` in `packages/business/__tests__`).

- [ ] **Step 8:** Run both tests → PASS.

### Reviewer (extra)
- `listHiddenInboxIdsForMember` handles a missing `superAdmin` key fail-closed (`hasWorkspacePermission`).
- `resolveAudienceUserIds` checks `workspaceId` (no cross-tenant).
- No cycle introduced.

### Tester

```bash
pnpm --filter @chatbotx.io/business exec vitest run src/inbox/__tests__/smtp-ownership.test.ts __tests__/workspace-member-delete-clears-inbox-owner.test.ts
pnpm --filter @chatbotx.io/business check-types
pnpm check:circular
```

- [ ] **Commit:** `feat(inbox): add smtp mailbox ownership service and clear owner on member removal`

---

## Task 3: Settings — actions, public API, UI (Wave 2)

**Consumes:** `smtpOwnershipService.setOwner`.

**Files:**
- Modify: `packages/business/src/integration-smtp/service.ts` (`connect`, `update`, `listByWorkspace` / `findByIdForWorkspace` return `ownerUserId`)
- Modify: `apps/builder/src/features/integration-smtp/schema/mutation.ts`, `schema/resource.ts`
- Modify: `apps/builder/src/features/integration-smtp/actions/create-smtp.action.ts`, `update-smtp.action.ts`
- Modify: `apps/builder/src/features/integration-smtp/api/public.ts`
- Modify: `apps/builder/src/features/inboxes/schema/action.ts` (`publicInboxResource` + `ownerUserId`)
- Create: `apps/builder/src/features/integration-smtp/components/smtp-owner-field.tsx`
- Modify: `create-smtp-form.tsx`, `edit-smtp-form.tsx`
- Modify: `apps/builder/messages/en.json`, `ru.json`
- Test: `apps/builder/__tests__/smtp-actions-thin.test.ts`, `apps/builder/__tests__/smtp-integrations-public-api.test.ts`

### Coder

- [ ] **Step 1: Failing tests.**

In `smtp-actions-thin.test.ts`, add:
- non-admin `ctx.workspaceMemberPermissions = { superAdmin: false }` with `ownerUserId: "u1"` → throws `smtpOwnerSuperAdminRequired`, and `integrationSmtpService.update` is not called;
- admin → `update` is called with `ownerUserId: "u1"`;
- non-admin **without** `ownerUserId` in input → still allowed (backward compatible: managers editing host/password stays as today).

In `smtp-integrations-public-api.test.ts`:
- `update` passes `ownerUserId` through;
- `get` returns `ownerUserId`.

- [ ] **Step 2: Schema.** In `mutation.ts`, add to **both** `createSmtpRequest` and `updateSmtpRequest`:

```ts
  ownerUserId: zodBigintAsString()
    .nullable()
    .optional()
    .describe("Personal mailbox owner (workspace member user id), or null for a shared mailbox. Get ids from `workspaceMembers.list`. Omit to keep unchanged."),
```

`resource.ts`: add `ownerUserId: z.string().nullable()` to `integrationSmtpResource` and to `IntegrationSmtpEditable`.

- [ ] **Step 3: Service.**
- `connect` accepts `ownerUserId?: string | null`. After the inbox is created and inside the same flow, if it is defined, call `smtpOwnershipService.setOwner({ workspaceId, inboxId: inbox.id, ownerUserId })`.
- `UpdateSmtpInput` gets `ownerUserId?: string | null`. In `update`, if `!== undefined`, call `setOwner` with the integration's `inboxId`.
- Read methods join `inbox.ownerUserId` (`with: { inbox: { columns: { ownerUserId: true } } }`) and flatten it to `ownerUserId`.

- [ ] **Step 4: Actions** (both). After parsing:

```ts
    if (
      parsedInput.ownerUserId !== undefined &&
      !hasWorkspacePermission(ctx.workspaceMemberPermissions, "superAdmin")
    ) {
      throw new ChatbotXException(
        "You need to be a super admin to change the mailbox owner",
        "smtpOwnerSuperAdminRequired",
        403,
      )
    }
```

Imports: `hasWorkspacePermission` from `@/lib/auth/permission-routes`, `ChatbotXException` from `@chatbotx.io/business/errors`. Pass `ownerUserId` into `connect` / `update`.

- [ ] **Step 5: Public API.** `toPublicResource` adds `ownerUserId: row.ownerUserId ?? null`. `create` / `update` forward `input.ownerUserId`. Append to the `create` / `update` descriptions: "Set `ownerUserId` to a member user id (from `workspaceMembers.list`) to make it a personal mailbox, or null for shared." In `inboxes/schema/action.ts` → `publicInboxResource.pick({ …, ownerUserId: true })`.

- [ ] **Step 6: UI field** `smtp-owner-field.tsx` (client). Use `useWorkspaceMembers(workspaceId)` from `@/features/users/provider/user-hook` and the existing `SelectField`:

```tsx
"use client"
import { useTranslations } from "next-intl"
import { SelectField } from "@/components/form/select-field" // use the same import create-smtp-form.tsx uses
import { useWorkspaceMembers } from "@/features/users/provider/user-hook"

const SHARED_VALUE = "shared"

type SmtpOwnerFieldProps = { workspaceId: string }

export const SmtpOwnerField = ({ workspaceId }: SmtpOwnerFieldProps) => {
  const t = useTranslations()
  const { data: members = [] } = useWorkspaceMembers(workspaceId)
  const options = [
    { value: SHARED_VALUE, label: t("smtp.owner.shared") },
    ...members.map((member) => ({
      value: member.user.id,
      label: member.user.name || member.user.email,
    })),
  ]
  return (
    <SelectField
      description={t("smtp.owner.description")}
      label={t("smtp.owner.label")}
      name="ownerUserId"
      options={options}
      // map SHARED_VALUE <-> null with the same value/onChange adapter style SelectField supports
    />
  )
}
```

Match `SelectField`'s real props (read `create-smtp-form.tsx`) and map `"shared"` ↔ `null`.

Render `<SmtpOwnerField />` in both forms only when the page knows the viewer is `superAdmin`: pass `canManageOwner` from the server page (the channel page already resolves permissions; grep `requireWorkspacePermission` in `settings/channels/smtp`). If not admin, don't render it and don't send `ownerUserId` (keep it `undefined` in defaults).

- [ ] **Step 7: i18n.** Add to the `smtp` object in `en.json`:

```json
"owner": {
  "label": "Mailbox owner",
  "description": "Personal mailbox: only the owner and admins see its emails. Shared: everyone with inbox access.",
  "shared": "Shared mailbox"
}
```

`ru.json`:

```json
"owner": {
  "label": "Владелец ящика",
  "description": "Личный ящик: письма видят только владелец и администраторы. Общий: все, у кого есть доступ к диалогам.",
  "shared": "Общий ящик"
}
```

Other locales: run `pnpm --filter builder i18n:check`. If it fails on missing keys, copy the English text into each locale's `smtp.owner` (same as the repo does for untranslated keys).

- [ ] **Step 8:** Run the tests → PASS.

### Reviewer (extra)
- Password is still never in the public responses.
- A non-admin update without `ownerUserId` behaves exactly as before.
- Form default for edit: `ownerUserId` from `IntegrationSmtpEditable`.
- `.bind(null, …)` unchanged.

### Tester

```bash
pnpm --filter builder exec vitest run __tests__/smtp-actions-thin.test.ts __tests__/smtp-integrations-public-api.test.ts
pnpm --filter @chatbotx.io/business exec vitest run __tests__/integration-smtp-service.test.ts
pnpm --filter builder i18n:check
pnpm --filter builder check-types
```

- [ ] **Commit:** `feat(smtp): let admins mark an smtp mailbox personal or shared`

---

## Task 4: Message repository exclusion (Wave 3)

**Files:**
- Modify: `packages/database/src/repositories/message/message-repository.ts` (interfaces)
- Modify: `packages/database/src/sharding/message/repository/sharded-message-repository.ts`
- Test: `packages/database/__tests__/sharded-message-exclude-contact-inbox.test.ts`

**Produces:**
- `ListMessagesQuery.excludeContactInboxIds?: string[]`
- `FindLastByConversationOptions.excludeContactInboxIds?: string[]`
- `FindTriggerMessage` options `excludeContactInboxIds?: string[]`
- `CountUnreadIncomingByConversationsParams.excludeContactInboxIds?: string[]` (one flat list; a ContactInbox belongs to one contact, so a union across the batch is safe)

### Coder

- [ ] **Step 1: Failing test.** Find the existing sharded repo unit tests (`grep -rl "listByConversation" packages/database/__tests__`) and copy their shard-client mock. Assert:
- with `excludeContactInboxIds: ["ci1"]`, the generated where contains `notInArray(messageModel.contactInboxId, ["ci1"])` (inspect the SQL via `toSQL()` or the mock's received args the existing tests use);
- with `[]` or `undefined` → no extra predicate;
- `countUnreadIncomingByConversations` SQL text contains `<> ALL(` only when the list is non-empty.

- [ ] **Step 2: Implement.** In `queryShardForMessages`, `findLastByConversation` and `findByIdInConversation`:

```ts
if (excludeContactInboxIds?.length) {
  whereConditions.push(notInArray(messageModel.contactInboxId, excludeContactInboxIds))
}
```

In `countUnreadIncomingByConversations`, inside the inner `WHERE`:

```ts
${params.excludeContactInboxIds?.length
  ? sql`AND ${messageModel.contactInboxId} <> ALL(${sql`ARRAY[${sql.join(
      params.excludeContactInboxIds.map((id) => sql`${id}::bigint`), sql`, `)}]`})`
  : sql``}
```

Thread the option through `findTriggerMessage` → `findByIdInConversation`.

- [ ] **Step 3:** Tests → PASS.

### Reviewer (extra)
- The empty-array guard is on every site.
- The `bigint` cast matches the `contactInboxId` column type.
- No behaviour change when the option is absent.

### Tester

```bash
pnpm --filter @chatbotx.io/database exec vitest run __tests__/sharded-message-exclude-contact-inbox.test.ts
pnpm --filter @chatbotx.io/database check-types
```

- [ ] **Commit:** `feat(database): allow excluding contact inboxes in message reads`

---

## Task 5: Conversation list / find ACL (Wave 3)

**Consumes:** `smtpOwnershipService.listHiddenInboxIdsForMember`, `hiddenContactInboxIds`, Task 4 options.

**Files:**
- Modify: `apps/builder/src/features/conversations/queries/build-conversation-where.ts`
- Modify: `apps/builder/src/features/conversations/queries/list-conversations.query.ts`
- Modify: `apps/builder/src/features/conversations/api/private.ts`
- Modify: `apps/builder/src/features/chat/queries/get-inbox-initial-state.query.ts` (+ its caller `inbox/page.tsx` if it builds the access object)
- Create: `apps/builder/src/features/conversations/lib/member-inbox-access.ts`
- Test: `apps/builder/src/features/conversations/queries/__tests__/list-conversations.query.test.ts`, `apps/builder/__tests__/get-inbox-initial-state.test.ts`

**Interface:**

```ts
// list-conversations.query.ts
export type ConversationAccess = { includeEmailAndPhone: boolean; hiddenInboxIds?: string[] }
listConversations(data, access: ConversationAccess)
findConversation(input, access?: Pick<ConversationAccess, "hiddenInboxIds">)

// member-inbox-access.ts
export const resolveMemberHiddenInboxIds = (input: {
  workspaceId: string; userId: string; permissions: WorkspaceMemberPermissions
}) => smtpOwnershipService.listHiddenInboxIdsForMember({ workspaceId: input.workspaceId, viewer: input })
```

### Coder

- [ ] **Step 1: Failing tests** in `list-conversations.query.test.ts` (existing `buildConversationWhere` describe):

```ts
test("hiddenInboxIds adds visible-contact-inbox existence", () => {
  const where = buildConversationWhere("w1", {}, null, { hiddenInboxIds: ["i1"] })
  expect(where.contactInboxes).toEqual({ inboxId: { notIn: ["i1"] } })
})
test("merges with channel filter", () => {
  const where = buildConversationWhere("w1", { channel: "whatsapp" }, null, { hiddenInboxIds: ["i1"] })
  expect(where.contactInboxes).toEqual({ channel: "whatsapp", inboxId: { notIn: ["i1"] } })
})
test("no hidden ids → unchanged", () => {
  expect(buildConversationWhere("w1", {}, null, { hiddenInboxIds: [] }).contactInboxes).toBeUndefined()
})
```

Add `listConversations` tests with the mocked `conversationService.findManyQuery` and message repository:
- the contact has CI `ci1` (inbox `i1`, hidden) and `ci2` (inbox `i2`) → the response `contactInboxes` holds only `ci2`;
- `findLastByConversation` received `excludeContactInboxIds: ["ci1"]`;
- `countUnreadIncomingByConversations` received `excludeContactInboxIds: ["ci1"]`.

`findConversation` with only hidden CIs → throws not found.

- [ ] **Step 2: `buildConversationWhere`.** Add `hiddenInboxIds?: string[]` to the options type. **After** the channel block:

```ts
  // ── personal SMTP visibility (member sessions only) ─────────────────────
  // Relational where = EXISTS: keep conversations with ≥1 visible contact inbox.
  if (options.hiddenInboxIds?.length) {
    const current = isQueryWhere(where.contactInboxes) ? where.contactInboxes : {}
    where.contactInboxes = { ...current, inboxId: { notIn: options.hiddenInboxIds } }
  }
```

- [ ] **Step 3: `listConversations`.**
- Pass `hiddenInboxIds` into `buildConversationWhere`.
- For each page row: `const excluded = hiddenContactInboxIds(c.contactInboxes, access.hiddenInboxIds)`.
- Pass `excludeContactInboxIds: excluded` to `findLastByConversation`.
- `countUnreadIncoming` gets the flat union `page.flatMap(...)` → `excludeContactInboxIds`.
- Map `contactInboxes: mapConversationContactInboxes(c.contactInboxes.filter((ci) => !excluded.includes(ci.id)))`.
- Pass the same filtered list into `resolveConversationContact`.

- [ ] **Step 4: `findConversation(input, access?)`.**
- After load: `excluded = hiddenContactInboxIds(conversation.contactInboxes, access?.hiddenInboxIds)`.
- If `conversation.contactInboxes.length > 0 && excluded.length === conversation.contactInboxes.length` → `throw notFoundException("Conversation not found")`.
- Apply the same exclusion to the last message, unread and mapping.

- [ ] **Step 5: Wire member callers.** In `conversations/api/private.ts`, the list handlers (both) and the find handler:

```ts
const hiddenInboxIds = await resolveMemberHiddenInboxIds({
  workspaceId: input.workspaceId,
  userId: context.user.id,
  permissions: context.workspaceMember.permissions,
})
await listConversations(input, { includeEmailAndPhone: …, hiddenInboxIds })
await findConversation(input, { hiddenInboxIds })
```

In `get-inbox-initial-state.query.ts`, accept `hiddenInboxIds` from the page (`inbox/page.tsx` already has `user` and `targetWorkspaceMember`) and pass it to both calls.

**Public API (`conversations/api/public.ts`) stays unchanged** (tokens see all).

- [ ] **Step 6:** Tests → PASS. Also update `apps/builder/__tests__/get-inbox-initial-state.test.ts` mocks for the new argument.

### Reviewer (extra)
- Every caller of `listConversations` / `findConversation` is listed: private ×3 + initial state ×2 get the ids; public ×2 don't.
- The `findWithFullRelations` `messages: true` relation is still overwritten by the mapper (no raw messages leak).
- Search `chat-store.ts`: no client path bypasses the private API.

### Tester

```bash
pnpm --filter builder exec vitest run src/features/conversations/queries/__tests__/list-conversations.query.test.ts __tests__/get-inbox-initial-state.test.ts __tests__/conversations-authenticated-api-block-gate.test.ts
pnpm --filter builder check-types
```

Spec cases covered: T2, T3, T5, T6, T17 (public unchanged).

- [ ] **Commit:** `feat(inbox): hide personal smtp conversations and messages from other members`

---

## Task 6: Message history, single message, send resolution (Wave 3)

**Consumes:** Task 2 and Task 4.

**Files:**
- Modify: `packages/business/src/message/list-for-conversation.ts` (`listForConversation`, `findByIdWithUrls`)
- Modify: `apps/builder/src/features/messages/queries/index.ts` (`listMessages`, `findMessage` accept `hiddenInboxIds`)
- Modify: `apps/builder/src/features/messages/api/private.ts` (list, get, flow-response, create)
- Modify: `apps/builder/src/features/messages/actions/create-message.action.ts`, `edit-message.action.ts`, `delete-message.action.ts`
- Modify: `packages/business/src/conversation/service.ts` (`resolveContactInboxForConversation`)
- Test: `packages/business/__tests__/message-list-for-conversation.test.ts`, `packages/business/src/conversation/__tests__/conversation.service.test.ts`

**Interfaces:**

```ts
listForConversation(input: ListForConversationInput & { hiddenInboxIds?: string[] })
findByIdWithUrls(input: { …existing…; hiddenInboxIds?: string[] })   // not found if hidden
conversationService.resolveContactInboxForConversation(props: {
  conversation: Pick<ConversationModel, "contactId">
  workspaceId: string
  inboxId?: string
  hiddenInboxIds?: string[]
}): Promise<ContactInboxModel>
```

### Coder

- [ ] **Step 1: Failing tests.**
- `listForConversation` with `hiddenInboxIds: ["i1"]` → `contactInboxService.listByContactId` returns ci1 (i1) and ci2 (i2). `repository.listByConversation` is called with `excludeContactInboxIds: ["ci1"]`.
- Explicit `contactInboxId: "ci1"` with `hiddenInboxIds: ["i1"]` → throws not found.
- `resolveContactInboxForConversation`:
  - explicit hidden `inboxId` → not found;
  - no `inboxId`, recent = hidden ci1, other = ci2 → returns ci2;
  - only hidden → not found.

- [ ] **Step 2: `listForConversation`.** When `hiddenInboxIds?.length` and a conversation exists:

```ts
const contactInboxes = await contactInboxService.listByContactId({
  workspaceId: input.workspaceId, contactId: conversation.contactId,
})
const excludeContactInboxIds = hiddenContactInboxIds(contactInboxes, input.hiddenInboxIds)
if (input.contactInboxId && excludeContactInboxIds.includes(input.contactInboxId)) {
  throw notFoundException("Conversation not found")
}
```

Pass `excludeContactInboxIds` to `repository.listByConversation`. Use the newest **visible** ContactInbox for the time anchor.

- [ ] **Step 3: `findByIdWithUrls`.** After the load, if `hiddenInboxIds?.length`:
- resolve `contactInboxService.findById(message.contactInboxId)`;
- if its `inboxId` is hidden → `throw notFoundException("Message not found")`.

- [ ] **Step 4: `resolveContactInboxForConversation`.**

```ts
const hidden = new Set(props.hiddenInboxIds ?? [])
if (inboxId && hidden.has(inboxId)) throw notFoundException("Inbox not found")
const contactInbox = inboxId
  ? await contactInboxService.findBy({ where: { contactId: conversation.contactId, inboxId } })
  : (await contactInboxService.listByContactId({ workspaceId, contactId: conversation.contactId }))
      .filter((ci) => !hidden.has(ci.inboxId))
      .sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime())[0]
```

Without hidden ids, keep the current `findRecentByContactId` path, so the behaviour is identical.

- [ ] **Step 5: Wire member callers.**
- `messages/api/private.ts`:
  - list → `listMessages({ …input, hiddenInboxIds })`;
  - get and flow-response → `findMessage({ …, hiddenInboxIds })`;
  - create → `resolveContactInboxForConversation({ …, hiddenInboxIds })`.
  - Compute the ids with `resolveMemberHiddenInboxIds` from Task 5 (`context.user.id`, `context.workspaceMember.permissions`).
- `create-message.action.ts`: compute from `ctx.user.id` + `ctx.workspaceMemberPermissions`; pass to resolve.
- `edit-message.action.ts` / `delete-message.action.ts`: after `findById`, if the message's contact inbox is hidden → not found. Use a small business helper `assertMessageVisibleForMember` if two call sites need it.

**Public `messages.*` and `contacts.*Messages` stay unchanged.**

- [ ] **Step 6:** Tests → PASS.

### Reviewer (extra)
- Send-path fallback for members never selects a hidden inbox.
- Public send paths (`resolveContactInboxForSend`) are untouched.
- No extra query when `hiddenInboxIds` is empty.

### Tester

```bash
pnpm --filter @chatbotx.io/business exec vitest run __tests__/message-list-for-conversation.test.ts src/conversation/__tests__/conversation.service.test.ts
pnpm --filter builder exec vitest run $(rg -l "createMessageAction|listMessagesAuthenticatedAPI" apps/builder/__tests__ | tr '\n' ' ')
pnpm --filter builder check-types && pnpm --filter @chatbotx.io/business check-types
```

Spec cases covered: T4, T11, T12, T10 (superAdmin send), T17.

- [ ] **Commit:** `feat(messages): enforce personal smtp visibility on history and send`

---

## Task 7: Inbound auto-assign + push recipients (Wave 4)

**Consumes:** `smtpOwnershipService.resolveAudienceUserIds`.

**Files:**
- Modify: `packages/worker-config/src/queues/notification/index.ts` (`notifyIncomingMessage.data.inboxId?: string`)
- Modify: `apps/worker/src/integration/handlers/received-message.ts` (auto-assign, enqueue `inboxId`)
- Modify: `apps/worker/src/notification/handlers/send-push.ts` (`resolveRecipientUserIds`)
- Test: `apps/worker/__tests__/received-message.test.ts`, `apps/worker/__tests__/notification/send-push-expo.test.ts`

### Coder

- [ ] **Step 1: Failing tests.**

`send-push-expo.test.ts`:
- job `notifyIncomingMessage` with `inboxId: "i1"`, `smtpOwnershipService.resolveAudienceUserIds` → `["u1", "u3"]`, conversation assigned to `u5` → device tokens requested for `["u1", "u3"]`;
- `resolveAudienceUserIds` → `null` → existing behaviour (assignee `u5`).

`received-message.test.ts`:
- inbound on personal SMTP (`inbox.channel = "smtp"`, `inbox.ownerUserId = "u1"`), conversation unassigned → `conversationService.claimAssignmentIfUnassigned` called with `assignedId: "u_u1"`;
- assigned conversation → the claim returns `"alreadyAssigned"`, no error;
- shared inbox → not called;
- the enqueued job data contains `inboxId: inbox.id`.

- [ ] **Step 2: Job type.** Add `inboxId?: string` to `NotificationJobNotifyIncomingMessage.data`.

- [ ] **Step 3: received-message.** In `persistMessage` after save, before the push block (`isNew && inbound`):

```ts
  if (isNew && inbound && inbox.channel === channelTypes.enum.smtp && inbox.ownerUserId) {
    try {
      await conversationService.claimAssignmentIfUnassigned({
        assignedId: `u_${inbox.ownerUserId}`,
        conversation: { id: conversation.id },
        triggerContext: {
          triggerHandler: "personalSmtpOwner",
          triggerSource: "worker",
          triggerType: "personal_smtp_owner",
        },
        workspaceId: inbox.workspaceId,
      })
    } catch (err) {
      logger.warn({ err, inboxId: inbox.id }, "personal smtp auto-assign failed")
    }
  }
```

Check that `TriggerContext.triggerType` accepts a new literal (grep the type). If it is a closed union, add `"personal_smtp_owner"` to it, or reuse the closest existing value (e.g. `"global_router"` is wrong — add a new one). Pass `inboxId: inbox.id` in `enqueueIncomingNotification`.

- [ ] **Step 4: send-push.** In `resolveRecipientUserIds` before the assignee logic:

```ts
  if (job.type === "notifyIncomingMessage" && job.data.inboxId) {
    const audience = await smtpOwnershipService.resolveAudienceUserIds({
      workspaceId: job.data.workspaceId,
      inboxId: job.data.inboxId,
    })
    if (audience) {
      return job.data.excludeUserId ? audience.filter((id) => id !== job.data.excludeUserId) : audience
    }
  }
```

Add `smtpOwnershipService` to the business mock in both test files.

- [ ] **Step 5:** Tests → PASS.

### Reviewer (extra)
- Auto-assign failure never breaks message receipt (try/catch, `{ err }`).
- Push for shared/non-SMTP inboxes is byte-identical to before.
- Old jobs without `inboxId` still work.

### Tester

```bash
pnpm --filter worker exec vitest run __tests__/received-message.test.ts __tests__/notification/send-push-expo.test.ts
pnpm --filter worker check-types && pnpm --filter @chatbotx.io/worker-config check-types
```

Spec cases covered: T7, T8, T9.

- [ ] **Commit:** `feat(worker): auto-assign and notify personal smtp mailbox owners`

---

## Task 8: Targeted realtime for personal SMTP (Wave 4)

**Consumes:** `smtpOwnershipService.resolveAudienceUserIds`.

**Files:**
- Create: `packages/business/src/platform/publish-message-event.ts` (+ export in `platform/index.ts`)
- Test: `packages/business/__tests__/publish-message-event.test.ts`
- Modify (call sites, content-bearing and possibly SMTP):
  - `apps/worker/src/integration/handlers/received-message.ts:1394` (`messageCreated`)
  - `apps/worker/src/chat/handlers/send-flow-step.ts:998` and `:1283` (`messageCreated`)
  - `packages/business/src/message/create-outgoing.ts:364` (`messageCreated`)
  - `apps/builder/src/features/messages/actions/edit-message.action.ts:121` (`messageUpdated`)

**Interface:**

```ts
export const publishMessageEvent = async (input: {
  workspaceId: string
  inboxId: string | null | undefined
  event: RealtimeEventData
}): Promise<void>
```

### Coder

- [ ] **Step 1: Failing test:**
- shared → `publishToWorkspaceParty` called once, `sendToWorkspaceMember` not;
- personal (audience `["u1", "u3"]`) → `sendToWorkspaceMember` ×2 with each `userId`, `publishToWorkspaceParty` not called;
- `inboxId` null → workspace party;
- `resolveAudienceUserIds` throws → falls back to **targeted nothing**, logs `{ err }`. Fail closed: no workspace publish for a possibly-personal inbox.

- [ ] **Step 2: Implement:**

```ts
import { getChildLogger } from "@chatbotx.io/logger"
import type { RealtimeEventData } from "@chatbotx.io/partysocket-config"
import { smtpOwnershipService } from "../inbox/smtp-ownership"
import { publishToWorkspaceParty, sendToWorkspaceMember } from "./realtime-broadcast"

const logger = getChildLogger({ module: "publish-message-event" })

export const publishMessageEvent = async ({ workspaceId, inboxId, event }: {
  workspaceId: string; inboxId: string | null | undefined; event: RealtimeEventData
}): Promise<void> => {
  if (!inboxId) {
    publishToWorkspaceParty(workspaceId, event)
    return
  }
  let audience: string[] | null
  try {
    audience = await smtpOwnershipService.resolveAudienceUserIds({ workspaceId, inboxId })
  } catch (err) {
    logger.error({ err, workspaceId, inboxId }, "Failed to resolve message event audience")
    return
  }
  if (!audience) {
    publishToWorkspaceParty(workspaceId, event)
    return
  }
  const results = await Promise.allSettled(
    audience.map((userId) => sendToWorkspaceMember({ workspaceId, userId }, event)),
  )
  for (const result of results) {
    if (result.status === "rejected") {
      logger.error({ err: result.reason, workspaceId, inboxId }, "Failed to send targeted message event")
    }
  }
}
```

Match the real `getChildLogger` signature and the `RealtimeEventData` import path used in `realtime-broadcast.ts`.

- [ ] **Step 3: Replace the five call sites:**

```ts
await publishMessageEvent({ workspaceId: inbox.workspaceId, inboxId: inbox.id, event: { eventType: RealtimeEventType.messageCreated, data: message } })
```

- `inboxId` comes from `inbox.id`, `contactInbox.inboxId` or `targetContactInbox.inboxId` as in scope.
- In `edit-message.action.ts`, resolve the inbox id from `message.contactInboxId` through `contactInboxService`.
- Keep the call non-blocking where the original was fire-and-forget: `void publishMessageEvent(...)`.

- [ ] **Step 4:** Update the mocks in `received-message.test.ts` and `integration-worker-incoming-message.test.ts` (`publishMessageEvent: vi.fn()`), plus any send-flow-step / create-outgoing tests that assert `publishToWorkspaceParty` for `messageCreated`.

### Reviewer (extra)
- Exactly the content-bearing sites listed. Id-only events and never-SMTP channels are untouched (spec §6).
- No `await` added in a hot path that previously was sync without a reason.
- Mocks are updated, not deleted.

### Tester

```bash
pnpm --filter @chatbotx.io/business exec vitest run __tests__/publish-message-event.test.ts
pnpm --filter worker exec vitest run __tests__/received-message.test.ts __tests__/integration-worker-incoming-message.test.ts $(rg -l "send-flow-step|sendFlowStep" apps/worker/__tests__ | tr '\n' ' ')
pnpm --filter @chatbotx.io/business exec vitest run $(rg -l "create-outgoing|createOutgoing" packages/business/__tests__ | tr '\n' ' ')
pnpm --filter worker check-types && pnpm --filter builder check-types
```

Spec case covered: T10.

- [ ] **Commit:** `feat(realtime): deliver personal smtp message events only to owner and admins`

---

## Task 9: Broadcast exclusion (Wave 4)

**Files:**
- Modify: `packages/business/src/inbox/service.ts` (`resolveExplicitBroadcastInboxIds`, `resolveChannelBroadcastInboxIds`)
- Modify: `packages/business/src/broadcast/service.ts` (`listOwnedTargetInboxes` / `assertBroadcastTargetsOwned`)
- Test: `packages/business/src/inbox/__tests__/resolve-broadcast-inbox-ids.test.ts`, `packages/business/src/broadcast/__tests__/broadcast-targets.test.ts`

### Coder

- [ ] **Step 1: Failing tests:**
- `resolve-broadcast-inbox-ids.test.ts`: assert both `findMany` calls include `ownerUserId: { isNull: true }` in `where` (mocked `db.query.inboxModel.findMany`).
- `broadcast-targets.test.ts`: a target inbox returned with `ownerUserId: "u1"` → throws `BroadcastValidationException` with message `"Personal mailbox cannot be used for broadcasts"` and field `"targets"`.

- [ ] **Step 2: Implement.**
- Add `ownerUserId: { isNull: true }` to both `where`s in `inbox/service.ts` (lines ~369 and ~409).
- `listOwnedTargetInboxes` selects `ownerUserId` too.
- In `assertBroadcastTargetsOwned`, after the ownership check:

```ts
    if (inboxes.some((inbox) => inbox.ownerUserId)) {
      throw new BroadcastValidationException("Personal mailbox cannot be used for broadcasts", "targets")
    }
```

The legacy integration-id strategy covers only WhatsApp/Messenger, never SMTP, so no change is needed there. Add a one-line comment only if a reviewer asks.

- [ ] **Step 3:** If the broadcast create UI lists inboxes for selection (`broadcast-inbox-multi-select.tsx`), filter out personal SMTP inboxes client-side using the `ownerUserId` now in the inbox resource. This is UX only; the server is the guard.

### Reviewer (extra)
- The empty-audience path still yields the existing empty-audience behaviour.
- `prepareBroadcast` goes through `forEachAudienceChunk` → `resolveBroadcastInboxIds`, so it is covered.

### Tester

```bash
pnpm --filter @chatbotx.io/business exec vitest run src/inbox/__tests__/resolve-broadcast-inbox-ids.test.ts src/broadcast/__tests__/broadcast-targets.test.ts src/broadcast/__tests__/broadcast.service.test.ts
pnpm --filter @chatbotx.io/business check-types
```

Spec cases covered: T14, T15, T16 (flow `send-email.ts` untouched — Tester confirms with `git diff --stat` that the file is unchanged).

- [ ] **Commit:** `feat(broadcasts): exclude personal smtp mailboxes from broadcast audiences`

---

## Task 10: Docs, CLI/MCP surface, full checks (Wave 5)

**Files:**
- Read and follow `.agents/skills/cli-mcp-docs/SKILL.md` (public API changed: `smtpIntegrations.*`, `inboxes.list`)
- Create: `docs/smtp-mailbox-ownership.md` (short operator doc: personal vs shared, who sees what, tokens see all, broadcast rule)
- Modify: `AGENTS.md` docs list (one line linking the new doc), then `pnpm sync:agent-instructions` **only if** shared invariants changed (they don't — skip sync)

### Coder
- [ ] Apply the `cli-mcp-docs` skill steps.
- [ ] Write the doc (≤ 60 lines, plain language).

### Tester (whole branch)

```bash
pnpm lint
pnpm --filter @chatbotx.io/database check-types
pnpm --filter @chatbotx.io/business check-types
pnpm --filter builder check-types
pnpm --filter worker check-types
pnpm check:circular
```

### Reviewer
- Run `invariant-guard` on the full branch diff (`git diff HEAD~N`).
- Run `security-review` (auth/scoping change) per CLAUDE.md.

- [ ] **Commit:** `docs(smtp): document personal and shared mailboxes`

---

## Stage 5: Validator (Claude Sonnet 5.5)

Input: the spec, this plan, `git log --oneline` of the branch, and the Tester tables from every task.

Output: a short report:
1. Spec T1–T18 → covered by which test, pass/fail.
2. Spec sections §1–§8 → implemented or gap.
3. Open risks (e.g. the accepted ordering limitation from spec §3).
4. What the owner must do: approve `db:migrate`, deploy builder + worker, set owners in settings.

## Deploy (Orchestrator, after owner approval)

1. Owner approves the migration SQL → `pnpm --filter @chatbotx.io/database db:migrate`.
2. Build/pin builder + worker images (same procedure as earlier SMTP fixes: `deploy/gkamion/docker-compose.prod.yml`).
3. Smoke test: mark one mailbox personal. A second agent account must not see a test email; the owner and an admin must.

## Self-review

- Spec coverage:
  - §1 → T1, T2
  - §2 → T2, T5
  - §3 → T4, T5, T6
  - §4 → T6
  - §5 → T7
  - §6 → T8
  - §7 → T9
  - §8 → T3, T10
  - member removal → T2
  - tokens → T5 and T6 leave public paths unchanged
- Names used consistently: `smtpOwnershipService`, `hiddenInboxIds`, `excludeContactInboxIds`, `hiddenContactInboxIds`, `resolveMemberHiddenInboxIds`, `publishMessageEvent`.
- Known verify-before-use points are flagged inline: exception import path, `findMembership` signature, `SelectField` props, `TriggerContext` union, logger signature.
