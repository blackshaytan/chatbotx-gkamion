# T02 dialog memory gate — mainDB-only v1

RED-stage integration gate for the agreed mainDB-only v1 dialog memory design.

## Agreed design (approved)

- Memory is disabled for ALL workspaces if ANY global "MessageShard" registry
  row exists (including inactive/draining/retired/archived rows).
- A single global "DialogMemoryTopology" singleton holds the topology epoch.
  It is updated atomically with MessageShard / ShardTimeRange changes, in the
  same main DB transaction, and is monotonic (deleting registry rows never
  restores an older epoch; TRUNCATE of the registry also invalidates memory).
- "sourceRevision" increments in the same main DB transaction as the
  meaningful Message / Attachment change.
- Publish CAS checks sourceRevision + memoryVersion + topologyEpoch.
- Coverage and delivery are independent concerns.

## Harness

- Runner: GitHub Actions only, `.github/workflows/dialog-memory-gate.yml`
  (manual `workflow_dispatch`; the feature branch will be routed into the
  existing `gkamion-checks.yml` by the parent workflow, default branch routing
  is not changed).
- Engine: postgres:17 service container, dedicated database
  `dialog_memory_gate`. This is a **stage-1 declarative-partition proof only**;
  it is NOT a validation of production storage. Production uses
  **TimescaleDB 2.30.2 on PostgreSQL 18.6** with compressed hypertables for
  `Message` / `Attachment`. The next mandatory CI stage must run on the pinned
  production image
  `timescale/timescaledb-ha@sha256:527b9bf3b0bdb654e18240217ded559282702cf34d005502540eb0bbe6f5d355`.
- Tests: `python scripts/dialog-memory-gate/test_invalidation.py`
  (stdlib unittest + psycopg; psycopg installed only in the workflow).
- Hard gates inside the script:
  - `DIALOG_MEMORY_TEST_DATABASE_URL` must be set explicitly; `DATABASE_URL`
    is never used and an identical copy is refused.
  - dbname parsed from that URL must equal `dialog_memory_gate` **before**
    any connection is attempted.
  - connected `current_database()` must equal `dialog_memory_gate` before
    any write.
  - `DIALOG_MEMORY_TEST_ALLOW_WRITES=1` is required.

## Fixture (scripts/dialog-memory-gate/fixture.sql)

Dedicated schema `dialog_memory_gate` with a representative subset:

- "Message": composite PK ("id", "createdAt"), `PARTITION BY RANGE
  ("createdAt")`; two current partitions "Message_2026_h1" /
  "Message_2026_h2"; tests create "Message_2027" to verify partition
  trigger inheritance (a trigger on the parent applies to future partitions).
- "Attachment": parent identity via ("workspaceId", "conversationId", "messageId", "messageCreatedAt"), no FK.
- "Workspace" / "Conversation": minimal.
- "MessageShard" / "ShardTimeRange": **global** shard registry shaped after
  `packages/database/src/sharding/message/schema/shard.ts` and
  `time-range.ts`. Any MessageShard row disables memory for every workspace.
  IDs in the fixture are intentionally TEXT (prototype only); production uses
  bigint for `MessageShard.id`.
- "DialogMemorySource" (per-conversation numeric "sourceRevision"),
  "DialogMemoryTopology" (single global singleton, integer "topologyEpoch"),
  "DialogMemory" (summary, "memoryVersion", published global "topologyEpoch").
- All message/attachment/conversation IDs and refs are text; "sourceRevision"
  is numeric (Decimal on the Python side).
- Fixture-owned helper `publish_summary_candidate(...)` is the prospective
  publish CAS contract used to validate candidate handling. It is NOT the
  real write path and does not protect Message/Attachment rows. In RED it
  performs an atomic conditional UPDATE checking sourceRevision, memoryVersion,
  the **locked global** `DialogMemoryTopology.topologyEpoch`, and the global
  `NOT EXISTS "MessageShard"` guard. The memory row's own stored
  `topologyEpoch` is intentionally **not** checked: a stale memory is allowed
  to catch up to the current global epoch when the registry is empty and the
  source revision/memory version still match.

## Prototype contract (scripts/dialog-memory-gate/invalidation.sql)

FIXED NAMES — the RED suite asserts these effects; the file is loaded by the
harness when it exists (GREEN stage). It must:

- `dialogMemory_message_invalidation` trigger ON "Message": bump
  "DialogMemorySource"."sourceRevision" of the row's conversation on
  INSERT, physical DELETE, and UPDATE of meaningful columns ("text",
  "contentAttributes", "senderType", "messageType", "contentType",
  "deletedAt", identity columns). UPDATEs touching only "updatedAt" are
  content-neutral and must NOT bump.
- `dialogMemory_attachment_invalidation` trigger ON "Attachment": same
  semantics, resolved through parent identity ("workspaceId", "conversationId",
  "messageId", "messageCreatedAt"). Rows without a resolvable parent must not
  touch any other conversation's memory.
- `dialogMemory_topology_invalidation` triggers ON "MessageShard" and
  "ShardTimeRange": bump the single global "DialogMemoryTopology"."topologyEpoch"
  on ANY insert (including inactive rows), on any change, and on
  DELETE / TRUNCATE; epoch is monotonic and must never decrement or revive
  older epochs.

The test file never creates these triggers; doing so inside tests would turn
RED green by accident.

## GREEN pending note

`scripts/dialog-memory-gate/invalidation.sql` has been added with the prototype
triggers above. The harness now applies it automatically when present, so the
RED failures are expected to turn into passing assertions on hosted CI. This
file is a dedicated test-schema prototype, not a production migration; do not
run deployment or push workflows from this task — parent will trigger hosted
validation.

## Race-test fix (CI 43088934787)

The original `test_publish_concurrent_with_edit_serializes_and_edit_wins` used
an unordered `threading.Barrier` and manually bumped `sourceRevision` inside the
edit thread, asserting that `publish` always loses a race. That is the wrong
invariant: the two operations can linearize in either order. The hosted failure
in run 43088934787 was the test expectation, not the contract, so the test has
been replaced by two deterministic, event-driven interleavings:

- **edit-before-publish**: `edit` updates `Message` (the trigger bumps
  `DialogMemorySource`) and stays open; `publish` attempts with the old snapshot;
  `edit` commits first; `publish` must observe the bumped `sourceRevision` and
  return `false`. No manual `sourceRevision` UPDATE in the edit thread.
- **publish-before-edit**: `publish` acquires the source/topology/memory locks and
  wins; `edit` then starts, bumps `sourceRevision` after the locks are released;
  a second `publish` using the old `sourceRevision` but the new `memoryVersion`
  must fail CAS.

No `sleep`; short transactions; the same statement-timeout and join assertions are
kept. The suite is still RED on the attachment-source-isolation regressions
below.

## Coverage

1. Message INSERT (normal and past partition date), UPDATE text,
   UPDATE contentAttributes, soft DELETE ("deletedAt"), physical DELETE,
   sender/channel provenance change, conversation reassignment (old + new
   owner), cross-workspace reassignment.
2. Attachment insert/update/delete; attachment without a resolvable parent
   leaves foreign memory untouched; source identity requires the full
   tuple (`workspaceId`, `conversationId`, `messageId`, `messageCreatedAt`).
   Forged attachments that reference a real foreign message by id/createdAt
   but carry their own workspace/conversation must not bump the foreign owner.
3. Rolled back transaction does not move the committed sourceRevision.
4. updatedAt-only update is content-neutral (no invalidation).
5. Two concurrent UPDATEs serialize sourceRevision with no lost update.
6. Stale summary fails CAS after a Message edit; fresh summary passes.
7. Deterministic publish/edit interleavings: edit-before-publish rejects the
   stale snapshot; publish-before-edit is allowed and a subsequent stale
   re-publish is rejected.
8. ANY MessageShard insert (incl. inactive) bumps the global topology epoch
   and blocks publish with an old epoch; registry DELETE / TRUNCATE also
   invalidates and never rolls the epoch back.
9. A fresh candidate snapshotted at the current global epoch is still
   rejected while any MessageShard row exists.
10. A cross-workspace shard invalidates memory for every workspace.
11. Topology change between snapshot and publish rejects the candidate.
12. A new partition created in the test inherits the parent trigger.
13. Unknown conversation never auto-creates a memory row.
14. A foreign workspace is never affected.
15. Stale epoch after a registry insert/delete is rejected; a fresh summary
    snapshotted at the post-removal epoch is accepted when the registry is empty.
16. Missing global topology singleton rejects publish safely.
17. All test harness connections carry a `statement_timeout` so concurrent
    threads fail fast instead of hanging.
