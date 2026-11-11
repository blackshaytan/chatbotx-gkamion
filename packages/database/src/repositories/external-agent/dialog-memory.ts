/**
 * Dialog memory repository — B1 scope.
 *
 * Only registration is public in this milestone. Read (snapshot/history) and
 * publish/reset will be added in B2 and C respectively.
 */

import { eq, sql } from "../../client"
import {
  dialogMemoryModel,
  dialogMemorySourceModel,
  dialogMemoryTopologyModel,
} from "../../schema"
import {
  DIALOG_MEMORY_REASONS,
  type DialogMemoryConfig,
  type DialogMemoryRegisterResult,
  type DialogMemoryScope,
  type DialogMemoryToken,
  validateDialogMemoryConfig,
  validateDialogMemoryScope,
} from "./dialog-memory-types"
import {
  DialogMemoryGuardError,
  DialogMemoryTransactionError,
  buildMemoryDto,
  guardNoMessageShards,
  guardRetentionPolicy,
  loadLockedGlobalTopology,
  loadLockedSourceAndMemory,
  requireConversationOwnership,
  runInMemoryTransaction,
  type MemorySelectRow,
} from "./dialog-memory-context"

export const dialogMemoryRepository = {
  async register(input: {
    scope: DialogMemoryScope
    config: DialogMemoryConfig
  }): Promise<DialogMemoryRegisterResult> {
    const scopeResult = validateDialogMemoryScope(input?.scope)
    if (scopeResult.kind === "invalid") {
      return scopeResult
    }

    const configResult = validateDialogMemoryConfig(input?.config)
    if (configResult.kind === "invalid") {
      return configResult
    }

    try {
      return await runInMemoryTransaction(async (tx) => {
        const global = await loadLockedGlobalTopology(tx)
        await requireConversationOwnership(tx, scopeResult.scope)
        await guardNoMessageShards(tx)
        await guardRetentionPolicy(tx)

        const { source, memory } = await loadLockedSourceAndMemory(
          tx,
          scopeResult.scope,
        )
        const hasSource = source !== undefined
        const hasMemory = memory !== undefined

        if (hasSource !== hasMemory) {
          throw new DialogMemoryGuardError(
            "inconsistent",
            hasSource
              ? DIALOG_MEMORY_REASONS.INCONSISTENT.SOURCE_WITHOUT_MEMORY
              : DIALOG_MEMORY_REASONS.INCONSISTENT.MEMORY_WITHOUT_SOURCE,
          )
        }

        let created = false
        let finalSource = source
        let finalMemory = memory

        if (!hasSource && !hasMemory) {
          const sourceInsertRows = await tx
            .insert(dialogMemorySourceModel)
            .values({
              workspaceId: scopeResult.scope.workspaceId,
              conversationId: scopeResult.scope.conversationId,
              sourceRevision: "0",
            })
            .onConflictDoNothing()
            .returning()

          const memoryInsertRows = await tx
            .insert(dialogMemoryModel)
            .values({
              workspaceId: scopeResult.scope.workspaceId,
              conversationId: scopeResult.scope.conversationId,
              summary: null,
              schemaVersion: configResult.config.schemaVersion,
              promptVersion: configResult.config.promptVersion,
              model: configResult.config.model,
              provider: configResult.config.provider,
              memoryVersion: "1",
              coveredSourceRevision: "0",
              topologyEpoch: global.topologyEpoch,
              coverageMessageId: null,
              coverageCreatedAt: null,
              lastError: null,
              lastAttemptAt: null,
            })
            .onConflictDoNothing()
            .returning()

          if (sourceInsertRows.length !== memoryInsertRows.length) {
            throw new DialogMemoryGuardError(
              "inconsistent",
              DIALOG_MEMORY_REASONS.INCONSISTENT.PARTIAL_INSERT,
            )
          }

          const reRead = await loadLockedSourceAndMemory(tx, scopeResult.scope)
          if (reRead.source === undefined || reRead.memory === undefined) {
            throw new DialogMemoryGuardError(
              "inconsistent",
              DIALOG_MEMORY_REASONS.INCONSISTENT.PARTIAL_INSERT,
            )
          }

          finalSource = reRead.source
          finalMemory = reRead.memory
          created = sourceInsertRows.length > 0

          if (created) {
            await tx
              .update(dialogMemoryTopologyModel)
              .set({ updatedAt: sql`clock_timestamp()` })
              .where(eq(dialogMemoryTopologyModel.id, "global"))
          }
        }

        if (finalSource === undefined || finalMemory === undefined) {
          throw new DialogMemoryGuardError(
            "inconsistent",
            DIALOG_MEMORY_REASONS.INCONSISTENT.PARTIAL_INSERT,
          )
        }

        const token: DialogMemoryToken = {
          sourceRevision: finalSource.sourceRevision,
          memoryVersion: finalMemory.memoryVersion,
          topologyEpoch: global.topologyEpoch,
        }

        return {
          kind: "ok",
          token,
          memory: buildMemoryDto(finalMemory),
          created,
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
  },
}

export type { MemorySelectRow }
