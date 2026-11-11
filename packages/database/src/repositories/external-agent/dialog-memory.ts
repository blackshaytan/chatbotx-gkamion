/**
 * Dialog memory repository — B2 adds readSnapshot on top of B1 register.
 *
 * readSnapshot returns a microsecond-precise, reverse-chronological page of the
 * full main-DB conversation history with attachments grouped by exact parent ref.
 * It uses the same short read-committed transaction and guards as register.
 */

import { eq, sql, type Transaction } from "../../client"
import {
  dialogMemoryModel,
  dialogMemorySourceModel,
  dialogMemoryTopologyModel,
} from "../../schema"
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
import { publishIfUnchanged, resetDerived } from "./dialog-memory-publication"
import {
  DIALOG_MEMORY_REASONS,
  type DialogMemoryAttachmentDto,
  type DialogMemoryConfig,
  type DialogMemoryCursor,
  type DialogMemoryMessageDto,
  type DialogMemoryPublishInput,
  type DialogMemoryPublishResult,
  type DialogMemoryRegisterResult,
  type DialogMemoryResetInput,
  type DialogMemoryResetResult,
  type DialogMemoryScope,
  type DialogMemorySnapshotInput,
  type DialogMemorySnapshotResult,
  type DialogMemoryToken,
  isCanonicalNonnegativeBigint,
  validateDialogMemoryConfig,
  validateDialogMemoryScope,
  validateDialogMemorySnapshotInput,
} from "./dialog-memory-types"

const MESSAGE_TABLE = "Message"
const ATTACHMENT_TABLE = "Attachment"
const MAX_ATTACHMENT_COUNT = 1000
const MAX_PAGE_LOGICAL_BYTES = 8n * 1024n * 1024n

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

        if (!(hasSource || hasMemory)) {
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

  async readSnapshot(
    input: DialogMemorySnapshotInput,
  ): Promise<DialogMemorySnapshotResult> {
    const validation = validateDialogMemorySnapshotInput(input)
    if (validation.kind === "invalid") {
      return validation
    }

    const { scope, limit, cursor, expectedToken } = validation.value

    try {
      return await runInMemoryTransaction<DialogMemorySnapshotResult>(
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

          const actualToken: DialogMemoryToken = {
            sourceRevision: source.sourceRevision,
            memoryVersion: memory.memoryVersion,
            topologyEpoch: global.topologyEpoch,
          }

          if (
            expectedToken !== undefined &&
            (expectedToken.sourceRevision !== actualToken.sourceRevision ||
              expectedToken.memoryVersion !== actualToken.memoryVersion ||
              expectedToken.topologyEpoch !== actualToken.topologyEpoch)
          ) {
            return {
              kind: "conflict",
              reason: DIALOG_MEMORY_REASONS.CONFLICT.TOKEN_STALE,
            }
          }

          if (cursor !== undefined) {
            const anchor = await tx.execute<{ exists: boolean }>(sql`
            SELECT EXISTS(
              SELECT 1
              FROM "${sql.raw(MESSAGE_TABLE)}"
              WHERE "id" = ${cursor.id}::bigint
                AND "createdAt" = ${cursor.createdAtMicros}::timestamptz
                AND "workspaceId" = ${scope.workspaceId}::bigint
                AND "conversationId" = ${scope.conversationId}::bigint
            ) AS "exists"
          `)
            if (anchor.rows[0]?.exists !== true) {
              return {
                kind: "invalid",
                reason:
                  DIALOG_MEMORY_REASONS.INVALID.CURSOR_ANCHOR_NOT_IN_SCOPE,
              }
            }
          }

          const history = await readMainHistory(tx, scope, { limit, cursor })

          return {
            kind: "ok",
            scope,
            token: actualToken,
            memory: buildMemoryDto(memory),
            items: history.items,
            hasMore: history.hasMore,
            nextCursor: history.nextCursor,
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
  },

  publishIfUnchanged(
    input: DialogMemoryPublishInput,
  ): Promise<DialogMemoryPublishResult> {
    return publishIfUnchanged(input)
  },

  resetDerived(
    input: DialogMemoryResetInput,
  ): Promise<DialogMemoryResetResult> {
    return resetDerived(input)
  },
}

type MessageRefRow = {
  id: string
  createdAtMicros: string
}

type MessageRow = {
  id: string
  createdAtMicros: string
  updatedAtMicros: string
  conversationId: string
  contactInboxId: string
  workspaceId: string
  text: string | null
  contentAttributes: unknown
  messageType: string
  contentType: string
  senderType: string
  senderId: string | null
  sourceId: string | null
  deletedAtMicros: string | null
  type: string
  parentId: string | null
  attributes: unknown
  sendError: string | null
}

type AttachmentRow = {
  id: string
  createdAtMicros: string
  updatedAtMicros: string
  workspaceId: string
  conversationId: string
  messageId: string
  messageCreatedAtMicros: string
  fileType: string
  sourceId: string | null
  mimeType: string
  width: number | null
  height: number | null
  size: number
  thumbnailPath: string | null
  originPath: string
  name: string | null
}

type Pagination = {
  limit: number
  cursor?: DialogMemoryCursor
}

type ReadHistoryResult = {
  items: DialogMemoryMessageDto[]
  hasMore: boolean
  nextCursor: DialogMemoryCursor | null
}

function parentMessageKey(row: {
  messageId: string
  messageCreatedAtMicros: string
}): string {
  return `${row.messageId}#${row.messageCreatedAtMicros}`
}

function messageKey(row: { id: string; createdAtMicros: string }): string {
  return `${row.id}#${row.createdAtMicros}`
}

function buildPairsFragment(pairs: { id: string; createdAtMicros: string }[]) {
  return sql.join(
    pairs.map(
      (pair) => sql`(${pair.id}::bigint, ${pair.createdAtMicros}::timestamptz)`,
    ),
    sql`, `,
  )
}

function mapAttachmentRow(row: AttachmentRow): DialogMemoryAttachmentDto {
  return { ...row }
}

function mapMessageRow(
  row: MessageRow,
  attachments: DialogMemoryAttachmentDto[],
): DialogMemoryMessageDto {
  return { ...row, attachments }
}

async function readMainHistory(
  tx: Transaction,
  scope: DialogMemoryScope,
  pagination: Pagination,
): Promise<ReadHistoryResult> {
  const cursorClause =
    pagination.cursor === undefined
      ? sql``
      : sql`AND ("createdAt","id") < (${pagination.cursor.createdAtMicros}::timestamptz, ${pagination.cursor.id}::bigint)`

  const refsResult = await tx.execute<MessageRefRow>(sql`
    SELECT
      "id"::text AS "id",
      to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtMicros"
    FROM "${sql.raw(MESSAGE_TABLE)}"
    WHERE "workspaceId" = ${scope.workspaceId}::bigint
      AND "conversationId" = ${scope.conversationId}::bigint
      ${cursorClause}
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT ${pagination.limit + 1}
  `)

  const allRefs = refsResult.rows
  const issuedRefs = allRefs.slice(0, pagination.limit)
  const hasMore = allRefs.length > pagination.limit
  const lastIssued = issuedRefs.at(-1)

  if (hasMore && lastIssued === undefined) {
    throw new DialogMemoryGuardError(
      "unavailable",
      DIALOG_MEMORY_REASONS.UNAVAILABLE.HISTORY_PREFLIGHT_INVALID,
    )
  }

  const nextCursor: DialogMemoryCursor | null =
    hasMore && lastIssued !== undefined ? lastIssued : null

  if (issuedRefs.length === 0) {
    return { items: [], hasMore: false, nextCursor: null }
  }

  const pairsFragment = buildPairsFragment(issuedRefs)

  const attachmentCountResult = await tx.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS "count"
    FROM (
      SELECT 1
      FROM "${sql.raw(ATTACHMENT_TABLE)}"
      WHERE "workspaceId" = ${scope.workspaceId}::bigint
        AND "conversationId" = ${scope.conversationId}::bigint
        AND ("messageId","messageCreatedAt") IN (${pairsFragment})
      LIMIT ${MAX_ATTACHMENT_COUNT + 1}
    ) AS "sub"
  `)

  const attachmentCountRow = attachmentCountResult.rows[0]
  if (
    attachmentCountResult.rows.length !== 1 ||
    typeof attachmentCountRow?.count !== "number" ||
    !Number.isSafeInteger(attachmentCountRow.count) ||
    attachmentCountRow.count < 0
  ) {
    throw new DialogMemoryGuardError(
      "unavailable",
      DIALOG_MEMORY_REASONS.UNAVAILABLE.HISTORY_PREFLIGHT_INVALID,
    )
  }

  if (attachmentCountRow.count > MAX_ATTACHMENT_COUNT) {
    throw new DialogMemoryGuardError(
      "unsupported",
      DIALOG_MEMORY_REASONS.UNSUPPORTED.ATTACHMENT_OVERFLOW,
    )
  }

  const payloadResult = await tx.execute<{
    messageBytes: string
    attachmentBytes: string
  }>(sql`
    SELECT
      COALESCE(SUM(
        octet_length(COALESCE("text",'')) +
        octet_length(COALESCE("sourceId",'')) +
        octet_length(COALESCE("parentId",'')) +
        octet_length(COALESCE("sendError",'')) +
        octet_length(COALESCE("contentAttributes"::text,'')) +
        octet_length(COALESCE("attributes"::text,''))
      ), 0)::bigint AS "messageBytes",
      COALESCE((
        SELECT SUM(
          octet_length(COALESCE("originPath",'')) +
          octet_length(COALESCE("thumbnailPath",'')) +
          octet_length(COALESCE("name",'')) +
          octet_length(COALESCE("mimeType",'')) +
          octet_length(COALESCE("sourceId",''))
        )
        FROM "${sql.raw(ATTACHMENT_TABLE)}"
        WHERE "workspaceId" = ${scope.workspaceId}::bigint
          AND "conversationId" = ${scope.conversationId}::bigint
          AND ("messageId","messageCreatedAt") IN (${pairsFragment})
      ), 0)::bigint AS "attachmentBytes"
    FROM "${sql.raw(MESSAGE_TABLE)}"
    WHERE "workspaceId" = ${scope.workspaceId}::bigint
      AND "conversationId" = ${scope.conversationId}::bigint
      AND ("id","createdAt") IN (${pairsFragment})
  `)

  const payloadRow = payloadResult.rows[0]
  if (
    payloadRow === undefined ||
    !isCanonicalNonnegativeBigint(payloadRow.messageBytes) ||
    !isCanonicalNonnegativeBigint(payloadRow.attachmentBytes)
  ) {
    throw new DialogMemoryGuardError(
      "unavailable",
      DIALOG_MEMORY_REASONS.UNAVAILABLE.HISTORY_PREFLIGHT_INVALID,
    )
  }

  const totalBytes =
    BigInt(payloadRow.messageBytes) + BigInt(payloadRow.attachmentBytes)
  if (totalBytes > MAX_PAGE_LOGICAL_BYTES) {
    throw new DialogMemoryGuardError(
      "unsupported",
      DIALOG_MEMORY_REASONS.UNSUPPORTED.PAYLOAD_TOO_LARGE,
    )
  }

  const messagesResult = await tx.execute<MessageRow>(sql`
    SELECT
      "id"::text AS "id",
      to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtMicros",
      to_char("updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAtMicros",
      "conversationId"::text AS "conversationId",
      "contactInboxId"::text AS "contactInboxId",
      "workspaceId"::text AS "workspaceId",
      "text",
      "contentAttributes",
      "messageType",
      "contentType",
      "senderType",
      "senderId"::text AS "senderId",
      "sourceId",
      to_char("deletedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "deletedAtMicros",
      "type",
      "parentId",
      "attributes",
      "sendError"
    FROM "${sql.raw(MESSAGE_TABLE)}"
    WHERE "workspaceId" = ${scope.workspaceId}::bigint
      AND "conversationId" = ${scope.conversationId}::bigint
      AND ("id","createdAt") IN (${pairsFragment})
  `)

  const attachmentsResult = await tx.execute<AttachmentRow>(sql`
    SELECT
      "id"::text AS "id",
      to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtMicros",
      to_char("updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAtMicros",
      "workspaceId"::text AS "workspaceId",
      "conversationId"::text AS "conversationId",
      "messageId"::text AS "messageId",
      to_char("messageCreatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "messageCreatedAtMicros",
      "fileType",
      "sourceId",
      "mimeType",
      "width",
      "height",
      "size",
      "thumbnailPath",
      "originPath",
      "name"
    FROM "${sql.raw(ATTACHMENT_TABLE)}"
    WHERE "workspaceId" = ${scope.workspaceId}::bigint
      AND "conversationId" = ${scope.conversationId}::bigint
      AND ("messageId","messageCreatedAt") IN (${pairsFragment})
    ORDER BY "createdAt" DESC, "id" DESC
  `)

  const messageByKey = new Map<string, MessageRow>()
  for (const row of messagesResult.rows) {
    messageByKey.set(messageKey(row), row)
  }

  const attachmentsByParent = new Map<string, DialogMemoryAttachmentDto[]>()
  for (const row of attachmentsResult.rows) {
    const key = parentMessageKey(row)
    const list = attachmentsByParent.get(key) ?? []
    list.push(mapAttachmentRow(row))
    attachmentsByParent.set(key, list)
  }

  const items = issuedRefs.map((ref: MessageRefRow) => {
    const key = messageKey(ref)
    const messageRow = messageByKey.get(key)
    if (messageRow === undefined) {
      throw new Error("message row missing for issued history ref")
    }
    return mapMessageRow(messageRow, attachmentsByParent.get(key) ?? [])
  })

  return { items, hasMore, nextCursor }
}
