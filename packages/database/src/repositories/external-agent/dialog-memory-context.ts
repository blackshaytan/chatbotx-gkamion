/**
 * Transaction-scoped helpers for dialog memory registration and reads.
 *
 * Every helper in this file accepts a Drizzle `Transaction` only; none of them
 * issues queries outside a transaction or creates connection pools. Public repo
 * methods own their own short `read committed` transactions via
 * {@link runInMemoryTransaction}.
 */

import {
  and,
  db,
  eq,
  getTableColumns,
  sql,
  type Transaction,
} from "../../client"
import {
  conversationModel,
  dialogMemoryModel,
  dialogMemorySourceModel,
  dialogMemoryTopologyModel,
} from "../../schema"
import { MessageShardRegistry } from "../../sharding/message/registry"
import { setLocalStatementTimeout } from "../../statement-timeout"
import type {
  DialogMemoryModel,
  DialogMemorySourceModel,
  DialogMemoryTopologyModel,
} from "../../types"
import {
  DIALOG_MEMORY_REASONS,
  type DialogMemoryDto,
  type DialogMemoryScope,
  type DialogMemoryToken,
} from "./dialog-memory-types"

const MAX_TRANSACTION_RETRIES = 3
const RETRYABLE_SQLSTATES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
])
const ERROR_CAUSE_DEPTH_LIMIT = 5

const STATEMENT_TIMEOUT = "5s" as const

/**
 * Guard error thrown from inside a transaction. Public methods map it to the
 * corresponding discriminated result. It never carries raw SQL or PII.
 */
export class DialogMemoryGuardError extends Error {
  readonly kind: "not_found" | "unsupported" | "inconsistent" | "unavailable"
  readonly reason: string

  constructor(
    kind: "not_found" | "unsupported" | "inconsistent" | "unavailable",
    reason: string,
  ) {
    super(`dialog-memory-guard:${kind}`)
    this.name = "DialogMemoryGuardError"
    this.kind = kind
    this.reason = reason
  }
}

/**
 * Transaction-level failure sanitized for public consumption. Public methods
 * convert this to `unavailable` with a constant reason.
 */
export class DialogMemoryTransactionError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super("dialog-memory-transaction-error")
    this.name = "DialogMemoryTransactionError"
    this.reason = reason
  }
}

function hasRetryableSqlState(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < ERROR_CAUSE_DEPTH_LIMIT; depth++) {
    if (current === null || current === undefined) {
      return false
    }
    if (typeof current !== "object") {
      return false
    }
    const candidate = current as {
      code?: unknown
      cause?: unknown
    }
    if (
      typeof candidate.code === "string" &&
      RETRYABLE_SQLSTATES.has(candidate.code)
    ) {
      return true
    }
    current = candidate.cause
  }
  return false
}

/**
 * Run `fn` inside a fresh `read committed` transaction on the single primary
 * pool. Retries the whole transaction up to 3 times on PG serialization or
 * deadlock failures. Sets the local search_path and a short statement timeout
 * inside every attempt. Non-retryable errors are converted to a typed
 * {@link DialogMemoryTransactionError} without exposing raw SQL or PII.
 */
export async function runInMemoryTransaction<T>(
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      return await db.transaction(
        async (tx) => {
          await tx.execute(
            sql`SET LOCAL search_path = pg_catalog, public, pg_temp`,
          )
          await setLocalStatementTimeout(tx, STATEMENT_TIMEOUT)
          return await fn(tx)
        },
        { isolationLevel: "read committed" },
      )
    } catch (error) {
      if (
        error instanceof DialogMemoryGuardError ||
        error instanceof DialogMemoryTransactionError
      ) {
        throw error
      }

      if (hasRetryableSqlState(error)) {
        if (attempt === MAX_TRANSACTION_RETRIES - 1) {
          throw new DialogMemoryTransactionError(
            DIALOG_MEMORY_REASONS.UNAVAILABLE.TRANSACTION_RETRY_EXHAUSTED,
          )
        }
        continue
      }

      throw new DialogMemoryTransactionError(
        DIALOG_MEMORY_REASONS.UNAVAILABLE.TRANSACTION_FAILED,
      )
    }
  }

  throw new DialogMemoryTransactionError(
    DIALOG_MEMORY_REASONS.UNAVAILABLE.TRANSACTION_RETRY_EXHAUSTED,
  )
}

export async function loadLockedGlobalTopology(
  tx: Transaction,
): Promise<DialogMemoryTopologyModel> {
  const [global] = await tx
    .select()
    .from(dialogMemoryTopologyModel)
    .where(eq(dialogMemoryTopologyModel.id, "global"))
    .for("update")

  if (!global) {
    throw new DialogMemoryGuardError(
      "unavailable",
      DIALOG_MEMORY_REASONS.UNAVAILABLE.GLOBAL_TOPOLOGY_MISSING,
    )
  }

  return global
}

export async function requireConversationOwnership(
  tx: Transaction,
  scope: DialogMemoryScope,
): Promise<void> {
  const [conversation] = await tx
    .select({ id: conversationModel.id })
    .from(conversationModel)
    .where(
      and(
        eq(conversationModel.workspaceId, scope.workspaceId),
        eq(conversationModel.id, scope.conversationId),
        eq(conversationModel.contactId, scope.expectedContactId),
      ),
    )
    .limit(1)

  if (!conversation) {
    throw new DialogMemoryGuardError(
      "not_found",
      DIALOG_MEMORY_REASONS.NOT_FOUND.CONVERSATION,
    )
  }
}

export async function guardNoMessageShards(tx: Transaction): Promise<void> {
  const shardCount = await new MessageShardRegistry(tx).countShards()
  if (shardCount > 0) {
    throw new DialogMemoryGuardError(
      "unsupported",
      DIALOG_MEMORY_REASONS.UNSUPPORTED.MESSAGE_SHARDED,
    )
  }
}

type TimescaleJobRow = {
  hypertable_schema: string
  hypertable_name: string
  proc_schema: string
  proc_name: string
  scheduled: boolean
}

async function checkRetentionGuard(
  tx: Transaction,
): Promise<
  | { kind: "ok" }
  | { kind: "unsupported"; reason: string }
  | { kind: "unavailable"; reason: string }
> {
  const extensionResult = await tx.execute<{ exists: boolean }>(
    sql`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS exists`,
  )

  const extensionExists = extensionResult.rows[0]?.exists
  if (extensionExists === false) {
    return { kind: "ok" }
  }
  if (extensionExists !== true) {
    return {
      kind: "unavailable",
      reason: DIALOG_MEMORY_REASONS.UNAVAILABLE.RETENTION_QUERY_FAILED,
    }
  }

  let jobs: TimescaleJobRow[]
  try {
    const result = await tx.execute<TimescaleJobRow>(
      sql`
        SELECT
          hypertable_schema,
          hypertable_name,
          proc_schema,
          proc_name,
          scheduled
        FROM timescaledb_information.jobs
        WHERE hypertable_schema = 'public'
          AND hypertable_name IN ('Message', 'Attachment')
      `,
    )
    jobs = result.rows.map((row) => ({
      hypertable_schema: String(row.hypertable_schema),
      hypertable_name: String(row.hypertable_name),
      proc_schema: String(row.proc_schema),
      proc_name: String(row.proc_name),
      scheduled: row.scheduled === true,
    }))
  } catch (error) {
    if (hasRetryableSqlState(error)) {
      throw error
    }
    return {
      kind: "unavailable",
      reason: DIALOG_MEMORY_REASONS.UNAVAILABLE.RETENTION_QUERY_FAILED,
    }
  }

  for (const job of jobs) {
    const isBuiltinCompression =
      (job.proc_schema === "_timescaledb_functions" ||
        job.proc_schema === "_timescaledb_internal") &&
      job.proc_name === "policy_compression"

    if (!isBuiltinCompression) {
      return {
        kind: "unsupported",
        reason: DIALOG_MEMORY_REASONS.UNSUPPORTED.RETENTION_JOB,
      }
    }
  }

  return { kind: "ok" }
}

export async function guardRetentionPolicy(tx: Transaction): Promise<void> {
  const result = await checkRetentionGuard(tx)
  if (result.kind !== "ok") {
    throw new DialogMemoryGuardError(result.kind, result.reason)
  }
}

export type MemorySelectRow = DialogMemoryModel & {
  coverageCreatedAtFormatted: string | null
  lastAttemptAtFormatted: string | null
  createdAtFormatted: string
  updatedAtFormatted: string
}

export async function loadLockedSourceAndMemory(
  tx: Transaction,
  scope: DialogMemoryScope,
): Promise<{
  source: DialogMemorySourceModel | undefined
  memory: MemorySelectRow | undefined
}> {
  const [source] = await tx
    .select()
    .from(dialogMemorySourceModel)
    .where(
      and(
        eq(dialogMemorySourceModel.workspaceId, scope.workspaceId),
        eq(dialogMemorySourceModel.conversationId, scope.conversationId),
      ),
    )
    .for("update")

  const [memory] = await tx
    .select({
      ...getTableColumns(dialogMemoryModel),
      coverageCreatedAtFormatted: sql<
        string | null
      >`to_char(${dialogMemoryModel.coverageCreatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
        "coverageCreatedAtFormatted",
      ),
      lastAttemptAtFormatted: sql<
        string | null
      >`to_char(${dialogMemoryModel.lastAttemptAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
        "lastAttemptAtFormatted",
      ),
      createdAtFormatted:
        sql<string>`to_char(${dialogMemoryModel.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
          "createdAtFormatted",
        ),
      updatedAtFormatted:
        sql<string>`to_char(${dialogMemoryModel.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
          "updatedAtFormatted",
        ),
    })
    .from(dialogMemoryModel)
    .where(
      and(
        eq(dialogMemoryModel.workspaceId, scope.workspaceId),
        eq(dialogMemoryModel.conversationId, scope.conversationId),
      ),
    )
    .for("update")

  return { source, memory }
}

export function buildMemoryDto(memory: MemorySelectRow): DialogMemoryDto {
  return {
    workspaceId: memory.workspaceId,
    conversationId: memory.conversationId,
    summary: (memory.summary as unknown) ?? null,
    schemaVersion: memory.schemaVersion,
    promptVersion: memory.promptVersion,
    model: memory.model,
    provider: memory.provider,
    memoryVersion: memory.memoryVersion,
    coveredSourceRevision: memory.coveredSourceRevision,
    topologyEpoch: memory.topologyEpoch,
    coverage:
      memory.coverageMessageId && memory.coverageCreatedAtFormatted
        ? {
            id: memory.coverageMessageId,
            createdAtMicros: memory.coverageCreatedAtFormatted,
          }
        : null,
    lastError: memory.lastError ?? null,
    lastAttemptAt: memory.lastAttemptAtFormatted ?? null,
    createdAt: memory.createdAtFormatted,
    updatedAt: memory.updatedAtFormatted,
  }
}

/** True when the token and the stored memory row describe the same published generation. */
export function tokenMatchesMemory(
  token: DialogMemoryToken,
  memory: DialogMemoryDto,
): boolean {
  return (
    token.sourceRevision === memory.coveredSourceRevision &&
    token.memoryVersion === memory.memoryVersion &&
    token.topologyEpoch === memory.topologyEpoch
  )
}

/** True when the token carries the current global topology epoch. */
export function tokenTopologyCurrent(
  token: DialogMemoryToken,
  globalTopologyEpoch: string,
): boolean {
  return token.topologyEpoch === globalTopologyEpoch
}
