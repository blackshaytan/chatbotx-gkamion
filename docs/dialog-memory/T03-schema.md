# T03 — Isolated dialog memory storage schema

This document describes the schema changes committed under T03. It is a
storage-only foundation; the triggers, registration service, and LLM
integration are T04.

## New tables

### `DialogMemorySource`

- Composite PK `(workspaceId, conversationId)`.
- `sourceRevision` bigint (string in app) NOT NULL DEFAULT '0', CHECK >= 0.
- Composite FK to `Conversation(workspaceId, id)` cascading.
- Requires the additive unique index `Conversation_workspaceId_id_key` on the
  existing `Conversation` table.

### `DialogMemory`

- Composite PK `(workspaceId, conversationId)` and composite FK to
  `Conversation(workspaceId, id)` cascading.
- `summary` jsonb opaque `Record<string, unknown>` nullable, no default.
- `schemaVersion` integer NOT NULL CHECK >= 1.
- `promptVersion`, `model`, `provider` text NOT NULL.
- `memoryVersion` bigint NOT NULL DEFAULT '1' CHECK >= 1.
- `coveredSourceRevision` bigint NOT NULL CHECK >= 0.
- `topologyEpoch` bigint NOT NULL DEFAULT '0' CHECK >= 0.
- `coverageMessageId` bigint nullable and `coverageCreatedAt` timestamp
  nullable with CHECK both NULL or both non-NULL. No FK to `Message`.
- `lastError` text nullable, `lastAttemptAt` timestamp nullable.

### `DialogMemoryTopology`

- Singleton row keyed by `id` text PRIMARY KEY DEFAULT 'global',
  CHECK `id = 'global'`.
- `topologyEpoch` bigint NOT NULL DEFAULT '0' CHECK >= 0.
- `updatedAt` only (no `createdAt`), using shared timestamp column.

## What is deliberately NOT in this commit

- No generated migration snapshot/journal/SQL (the maintainer will run the
  offline generator).
- No `db:migrate`, `db:push`, or introspection.
- No triggers, registration/publish logic, or LLM input formatting (T04).
- No stored freshness/state enum; freshness is computed from revisions and
  epoch.
- No FK to `Message` or `Attachment`.
- No partials, enums, or empty files.

## Verification status

`SCHEMA_IMPLEMENTED_PENDING_OFFLINE_GENERATION` — schema code is in place,
but migration generation and testing are intentionally left for the
maintainer-run offline step.
