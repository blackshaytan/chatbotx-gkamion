/**
 * Internal CAS publication helpers for dialog memory.
 *
 * `publishIfUnchanged` and `resetDerived` are wired into
 * {@link dialogMemoryRepository} as methods. They import only transaction-only
 * context helpers and never issue queries at module import time.
 */

import { sql, type Transaction } from "../../client"
import {
  buildMemoryDto,
  DialogMemoryGuardError,
  DialogMemoryTransactionError,
  guardNoMessageShards,
  guardRetentionPolicy,
  loadLockedGlobalTopology,
  loadLockedSourceAndMemory,
  requireConversationOwnership,
  runInMemoryTransaction,
} from "./dialog-memory-context"
import {
  DIALOG_MEMORY_REASONS,
  type DialogMemoryCursor,
  type DialogMemoryPublishInput,
  type DialogMemoryPublishResult,
  type DialogMemoryResetInput,
  type DialogMemoryResetResult,
  type DialogMemoryScope,
  type DialogMemoryToken,
  validateDialogMemoryPublishInput,
  validateDialogMemoryResetInput,
} from "./dialog-memory-types"

const DIALOG_MEMORY_TABLE = "DialogMemory"
const DIALOG_MEMORY_SOURCE_TABLE = "DialogMemorySource"
const DIALOG_MEMORY_TOPOLOGY_TABLE = "DialogMemoryTopology"
const MESSAGE_TABLE = "Message"

type PublishTransactionResult =
  | {
      kind: "ok"
      token: DialogMemoryToken
      memory: import("./dialog-memory-types").DialogMemoryDto
    }
  | { kind: "conflict"; reason: string }
  | { kind: "unregistered"; reason: string }
  | { kind: "inconsistent"; reason: string }
  | { kind: "invalid"; reason: string }

type ResetTransactionResult =
  | {
      kind: "ok"
      token: DialogMemoryToken
      memory: import("./dialog-memory-types").DialogMemoryDto
    }
  | { kind: "conflict"; reason: string }
  | { kind: "unregistered"; reason: string }
  | { kind: "inconsistent"; reason: string }

function currentToken(
  source: { sourceRevision: string },
  memory: { memoryVersion: string },
  global: { topologyEpoch: string },
): DialogMemoryToken {
  return {
    sourceRevision: source.sourceRevision,
    memoryVersion: memory.memoryVersion,
    topologyEpoch: global.topologyEpoch,
  }
}

function tokensEqual(a: DialogMemoryToken, b: DialogMemoryToken): boolean {
  return (
    a.sourceRevision === b.sourceRevision &&
    a.memoryVersion === b.memoryVersion &&
    a.topologyEpoch === b.topologyEpoch
  )
}

async function verifyCoverageInScope(
  tx: Transaction,
  scope: DialogMemoryScope,
  coverage: DialogMemoryCursor,
): Promise<boolean> {
  const result = await tx.execute<{ exists: boolean }>(sql`
    SELECT EXISTS(
      SELECT 1
      FROM "${sql.raw(MESSAGE_TABLE)}"
      WHERE "id" = ${coverage.id}::bigint
        AND "createdAt" = ${coverage.createdAtMicros}::timestamptz
        AND "workspaceId" = ${scope.workspaceId}::bigint
        AND "conversationId" = ${scope.conversationId}::bigint
    ) AS "exists"
  `)
  return result.rows[0]?.exists === true
}

export async function publishIfUnchanged(
  input: DialogMemoryPublishInput,
): Promise<DialogMemoryPublishResult> {
  const validation = validateDialogMemoryPublishInput(input)
  if (validation.kind === "invalid") {
    return validation
  }

  const { scope, expectedToken, summaryJson, coverage, config } =
    validation.value

  try {
    return await runInMemoryTransaction<PublishTransactionResult>(
      async (tx) => {
        const global = await loadLockedGlobalTopology(tx)
        await requireConversationOwnership(tx, scope)
        await guardNoMessageShards(tx)
        await guardRetentionPolicy(tx)

        const { source, memory } = await loadLockedSourceAndMemory(tx, scope)
        if (source === undefined && memory === undefined) {
          return {
            kind: "unregistered",
            reason: DIALOG_MEMORY_REASONS.UNREGISTERED.SCOPE_NOT_REGISTERED,
          }
        }
        if (source === undefined || memory === undefined) {
          throw new DialogMemoryGuardError(
            "inconsistent",
            source === undefined
              ? DIALOG_MEMORY_REASONS.INCONSISTENT.MEMORY_WITHOUT_SOURCE
              : DIALOG_MEMORY_REASONS.INCONSISTENT.SOURCE_WITHOUT_MEMORY,
          )
        }

        const actualToken = currentToken(source, memory, global)
        if (!tokensEqual(expectedToken, actualToken)) {
          return {
            kind: "conflict",
            reason: DIALOG_MEMORY_REASONS.CONFLICT.TOKEN_STALE,
          }
        }

        if (coverage !== null) {
          const exists = await verifyCoverageInScope(tx, scope, coverage)
          if (!exists) {
            return {
              kind: "invalid",
              reason: DIALOG_MEMORY_REASONS.INVALID.COVERAGE_NOT_IN_SCOPE,
            }
          }
        }

        const coverageIdFragment =
          coverage === null ? sql`NULL` : sql`${coverage.id}::bigint`
        const coverageCreatedAtFragment =
          coverage === null
            ? sql`NULL`
            : sql`${coverage.createdAtMicros}::timestamptz`

        const updateResult = await tx.execute<{ memoryVersion: string }>(sql`
          UPDATE "${sql.raw(DIALOG_MEMORY_TABLE)}"
          SET
            "summary" = ${summaryJson}::jsonb,
            "schemaVersion" = ${config.schemaVersion},
            "promptVersion" = ${config.promptVersion},
            "model" = ${config.model},
            "provider" = ${config.provider},
            "memoryVersion" = ("memoryVersion"::bigint + 1)::text,
            "coveredSourceRevision" = ${source.sourceRevision},
            "topologyEpoch" = ${global.topologyEpoch},
            "coverageMessageId" = ${coverageIdFragment},
            "coverageCreatedAt" = ${coverageCreatedAtFragment},
            "lastError" = NULL,
            "lastAttemptAt" = clock_timestamp(),
            "updatedAt" = clock_timestamp()
          WHERE "workspaceId" = ${scope.workspaceId}::bigint
            AND "conversationId" = ${scope.conversationId}::bigint
            AND "memoryVersion" = ${expectedToken.memoryVersion}
            AND EXISTS (
              SELECT 1
              FROM "${sql.raw(DIALOG_MEMORY_SOURCE_TABLE)}"
              WHERE "workspaceId" = ${scope.workspaceId}::bigint
                AND "conversationId" = ${scope.conversationId}::bigint
                AND "sourceRevision" = ${expectedToken.sourceRevision}
            )
            AND EXISTS (
              SELECT 1
              FROM "${sql.raw(DIALOG_MEMORY_TOPOLOGY_TABLE)}"
              WHERE "id" = 'global'
                AND "topologyEpoch" = ${expectedToken.topologyEpoch}
            )
          RETURNING "memoryVersion"
        `)

        if (updateResult.rows.length !== 1) {
          return {
            kind: "conflict",
            reason: DIALOG_MEMORY_REASONS.CONFLICT.TOKEN_STALE,
          }
        }

        const reRead = await loadLockedSourceAndMemory(tx, scope)
        if (reRead.source === undefined || reRead.memory === undefined) {
          throw new DialogMemoryGuardError(
            "inconsistent",
            DIALOG_MEMORY_REASONS.INCONSISTENT.PARTIAL_INSERT,
          )
        }

        const token = currentToken(reRead.source, reRead.memory, global)
        return {
          kind: "ok",
          token,
          memory: buildMemoryDto(reRead.memory),
        }
      },
    )
  } catch (error) {
    if (error instanceof DialogMemoryGuardError) {
      return { kind: error.kind, reason: error.reason }
    }
    if (error instanceof DialogMemoryTransactionError) {
      return { kind: "unavailable", reason: error.reason }
    }
    return {
      kind: "unavailable",
      reason: DIALOG_MEMORY_REASONS.UNAVAILABLE.TRANSACTION_FAILED,
    }
  }
}

export async function resetDerived(
  input: DialogMemoryResetInput,
): Promise<DialogMemoryResetResult> {
  const validation = validateDialogMemoryResetInput(input)
  if (validation.kind === "invalid") {
    return validation
  }

  const { scope, expectedToken } = validation.value

  try {
    return await runInMemoryTransaction<ResetTransactionResult>(async (tx) => {
      const global = await loadLockedGlobalTopology(tx)
      await requireConversationOwnership(tx, scope)
      await guardNoMessageShards(tx)
      await guardRetentionPolicy(tx)

      const { source, memory } = await loadLockedSourceAndMemory(tx, scope)
      if (source === undefined && memory === undefined) {
        return {
          kind: "unregistered",
          reason: DIALOG_MEMORY_REASONS.UNREGISTERED.SCOPE_NOT_REGISTERED,
        }
      }
      if (source === undefined || memory === undefined) {
        throw new DialogMemoryGuardError(
          "inconsistent",
          source === undefined
            ? DIALOG_MEMORY_REASONS.INCONSISTENT.MEMORY_WITHOUT_SOURCE
            : DIALOG_MEMORY_REASONS.INCONSISTENT.SOURCE_WITHOUT_MEMORY,
        )
      }

      const actualToken = currentToken(source, memory, global)
      if (!tokensEqual(expectedToken, actualToken)) {
        return {
          kind: "conflict",
          reason: DIALOG_MEMORY_REASONS.CONFLICT.TOKEN_STALE,
        }
      }

      const updateResult = await tx.execute<{ memoryVersion: string }>(sql`
          UPDATE "${sql.raw(DIALOG_MEMORY_TABLE)}"
          SET
            "summary" = NULL,
            "coverageMessageId" = NULL,
            "coverageCreatedAt" = NULL,
            "lastError" = NULL,
            "lastAttemptAt" = NULL,
            "coveredSourceRevision" = '0',
            "topologyEpoch" = ${global.topologyEpoch},
            "memoryVersion" = ("memoryVersion"::bigint + 1)::text,
            "updatedAt" = clock_timestamp()
          WHERE "workspaceId" = ${scope.workspaceId}::bigint
            AND "conversationId" = ${scope.conversationId}::bigint
            AND "memoryVersion" = ${expectedToken.memoryVersion}
            AND EXISTS (
              SELECT 1
              FROM "${sql.raw(DIALOG_MEMORY_SOURCE_TABLE)}"
              WHERE "workspaceId" = ${scope.workspaceId}::bigint
                AND "conversationId" = ${scope.conversationId}::bigint
                AND "sourceRevision" = ${expectedToken.sourceRevision}
            )
            AND EXISTS (
              SELECT 1
              FROM "${sql.raw(DIALOG_MEMORY_TOPOLOGY_TABLE)}"
              WHERE "id" = 'global'
                AND "topologyEpoch" = ${expectedToken.topologyEpoch}
            )
          RETURNING "memoryVersion"
        `)

      if (updateResult.rows.length !== 1) {
        return {
          kind: "conflict",
          reason: DIALOG_MEMORY_REASONS.CONFLICT.TOKEN_STALE,
        }
      }

      const reRead = await loadLockedSourceAndMemory(tx, scope)
      if (reRead.source === undefined || reRead.memory === undefined) {
        throw new DialogMemoryGuardError(
          "inconsistent",
          DIALOG_MEMORY_REASONS.INCONSISTENT.PARTIAL_INSERT,
        )
      }

      const token = currentToken(reRead.source, reRead.memory, global)
      return {
        kind: "ok",
        token,
        memory: buildMemoryDto(reRead.memory),
      }
    })
  } catch (error) {
    if (error instanceof DialogMemoryGuardError) {
      return { kind: error.kind, reason: error.reason }
    }
    if (error instanceof DialogMemoryTransactionError) {
      return { kind: "unavailable", reason: error.reason }
    }
    return {
      kind: "unavailable",
      reason: DIALOG_MEMORY_REASONS.UNAVAILABLE.TRANSACTION_FAILED,
    }
  }
}
