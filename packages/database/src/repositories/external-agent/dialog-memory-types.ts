/**
 * Pure types, DTOs and runtime validators for dialog memory.
 *
 * This module intentionally imports no database runtime (no `db`, no pools,
 * no queries) so it can be imported anywhere without booting a connection.
 */

const PG_BIGINT_MAX = 9223372036854775807n
const PG_INTEGER_MAX = 2147483647

/** Inclusive page size bounds from the T04 snapshot contract. */
export const DIALOG_MEMORY_PAGE_LIMIT_MIN = 1
export const DIALOG_MEMORY_PAGE_LIMIT_MAX = 200

/**
 * Fail-closed ceilings for one issued history page.
 * The contract requires a volume bound and forbids silent truncation, but it
 * does not fix the number. Crossing either ceiling returns `unsupported`
 * and no items. 64 MiB is the declared Attachment.size sum; 4096 is the
 * metadata-row ceiling so a page cannot be materialized unbounded.
 */
export const DIALOG_MEMORY_PAGE_ATTACHMENT_BYTE_BUDGET = 67_108_864
export const DIALOG_MEMORY_PAGE_ATTACHMENT_ROW_BUDGET = 4096

const CURSOR_MICROS_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

export const DIALOG_MEMORY_REASONS = {
  INVALID: {
    WORKSPACE_ID_NOT_CANONICAL_POSITIVE_BIGINT:
      "workspaceId must be a canonical positive bigint string within PostgreSQL bigint range",
    CONVERSATION_ID_NOT_CANONICAL_POSITIVE_BIGINT:
      "conversationId must be a canonical positive bigint string within PostgreSQL bigint range",
    EXPECTED_CONTACT_ID_NOT_CANONICAL_POSITIVE_BIGINT:
      "expectedContactId must be a canonical positive bigint string within PostgreSQL bigint range",
    SCHEMA_VERSION_NOT_INTEGER_IN_PG_INTEGER_RANGE:
      "schemaVersion must be an integer between 1 and 2147483647",
    PROMPT_VERSION_EMPTY: "promptVersion must be a non-empty string",
    MODEL_EMPTY: "model must be a non-empty string",
    PROVIDER_EMPTY: "provider must be a non-empty string",
    LIMIT_NOT_INTEGER_1_TO_200: "limit must be an integer between 1 and 200",
    CURSOR_ID_NOT_CANONICAL_POSITIVE_BIGINT:
      "cursor.id must be a canonical positive bigint string within PostgreSQL bigint range",
    CURSOR_DATE_NOT_MICROSECOND_UTC:
      "cursor.createdAtMicros must be a YYYY-MM-DDTHH:mm:ss.ffffffZ UTC timestamp",
    EXPECTED_TOKEN_NOT_VALID: "expectedToken is not a valid dialog memory token",
    MISSING_EXPECTED_TOKEN_WITH_CURSOR:
      "expectedToken is required when cursor is provided",
    CURSOR_ANCHOR_NOT_IN_SCOPE:
      "cursor anchor does not belong to this scope",
  },
  NOT_FOUND: {
    CONVERSATION: "conversation not found or contact mismatch",
  },
  UNSUPPORTED: {
    MESSAGE_SHARDED:
      "message sharding is not supported for dialog memory scope v1",
    RETENTION_JOB:
      "unsupported TimescaleDB job on Message or Attachment",
    ATTACHMENT_OVERFLOW:
      "history page would contain more than 1000 attachments",
    PAYLOAD_TOO_LARGE:
      "history page logical payload exceeds the supported size limit",
  },
  INCONSISTENT: {
    SOURCE_WITHOUT_MEMORY: "DialogMemorySource exists without DialogMemory",
    MEMORY_WITHOUT_SOURCE: "DialogMemory exists without DialogMemorySource",
    PARTIAL_INSERT: "partial source/memory insert detected",
  },
  UNREGISTERED: {
    SCOPE_NOT_REGISTERED: "dialog memory scope is not registered",
  },
  CONFLICT: {
    TOKEN_STALE: "expected token is stale",
  },
  UNAVAILABLE: {
    GLOBAL_TOPOLOGY_MISSING: "global dialog memory topology singleton is missing",
    RETENTION_QUERY_FAILED: "failed to query timescaledb retention metadata",
    TRANSACTION_RETRY_EXHAUSTED: "transaction retry exhausted",
    TRANSACTION_FAILED: "transaction failed",
    HISTORY_PREFLIGHT_INVALID: "history page preflight metadata is invalid or unavailable",
  },
} as const

export type DialogMemoryScope = {
  workspaceId: string
  conversationId: string
  expectedContactId: string
}

export type DialogMemoryConfig = {
  schemaVersion: number
  promptVersion: string
  model: string
  provider: string
}

/**
 * Published memory snapshot. `topologyEpoch` is the epoch stored on the row;
 * callers compare it with the token/global epoch to detect staleness.
 */
export type DialogMemoryDto = {
  workspaceId: string
  conversationId: string
  summary: unknown
  schemaVersion: number
  promptVersion: string
  model: string
  provider: string
  memoryVersion: string
  coveredSourceRevision: string
  topologyEpoch: string
  coverage: { id: string; createdAtMicros: string } | null
  lastError: string | null
  lastAttemptAt: string | null
  createdAt: string
  updatedAt: string
}

export type DialogMemoryToken = {
  sourceRevision: string
  memoryVersion: string
  topologyEpoch: string
}

export type DialogMemorySnapshotInput = {
  scope: DialogMemoryScope
  limit?: number
} & (
  | { cursor: DialogMemoryCursor; expectedToken: DialogMemoryToken }
  | { cursor?: null | undefined; expectedToken?: DialogMemoryToken | null }
)

export type DialogMemoryRegisterResult =
  | {
      kind: "ok"
      token: DialogMemoryToken
      memory: DialogMemoryDto
      created: boolean
    }
  | { kind: "not_found"; reason: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "inconsistent"; reason: string }
  | { kind: "invalid"; reason: string }
  | { kind: "unavailable"; reason: string }

const CANONICAL_POSITIVE_BIGINT_RE = /^[1-9]\d*$/
const CANONICAL_NONNEGATIVE_BIGINT_RE = /^0$|^[1-9]\d*$/

const isCanonicalPositiveBigint = (value: unknown): value is string =>
  typeof value === "string" &&
  CANONICAL_POSITIVE_BIGINT_RE.test(value) &&
  value.length <= 19 &&
  BigInt(value) <= PG_BIGINT_MAX

export const isCanonicalNonnegativeBigint = (value: unknown): value is string =>
  typeof value === "string" &&
  CANONICAL_NONNEGATIVE_BIGINT_RE.test(value) &&
  value.length <= 19 &&
  BigInt(value) <= PG_BIGINT_MAX

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0

export type DialogMemoryScopeValidationResult =
  | { kind: "ok"; scope: DialogMemoryScope }
  | { kind: "invalid"; reason: string }

export const validateDialogMemoryScope = (
  input: unknown,
): DialogMemoryScopeValidationResult => {
  if (typeof input !== "object" || input === null) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.WORKSPACE_ID_NOT_CANONICAL_POSITIVE_BIGINT,
    }
  }

  const candidate = input as {
    workspaceId?: unknown
    conversationId?: unknown
    expectedContactId?: unknown
  }

  if (!isCanonicalPositiveBigint(candidate.workspaceId)) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.WORKSPACE_ID_NOT_CANONICAL_POSITIVE_BIGINT,
    }
  }
  if (!isCanonicalPositiveBigint(candidate.conversationId)) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.CONVERSATION_ID_NOT_CANONICAL_POSITIVE_BIGINT,
    }
  }
  if (!isCanonicalPositiveBigint(candidate.expectedContactId)) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.EXPECTED_CONTACT_ID_NOT_CANONICAL_POSITIVE_BIGINT,
    }
  }

  return {
    kind: "ok",
    scope: {
      workspaceId: candidate.workspaceId,
      conversationId: candidate.conversationId,
      expectedContactId: candidate.expectedContactId,
    },
  }
}

export type DialogMemoryConfigValidationResult =
  | { kind: "ok"; config: DialogMemoryConfig }
  | { kind: "invalid"; reason: string }

export const validateDialogMemoryConfig = (
  input: unknown,
): DialogMemoryConfigValidationResult => {
  if (typeof input !== "object" || input === null) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.SCHEMA_VERSION_NOT_INTEGER_IN_PG_INTEGER_RANGE,
    }
  }

  const candidate = input as {
    schemaVersion?: unknown
    promptVersion?: unknown
    model?: unknown
    provider?: unknown
  }

  if (
    typeof candidate.schemaVersion !== "number" ||
    !Number.isSafeInteger(candidate.schemaVersion) ||
    candidate.schemaVersion < 1 ||
    candidate.schemaVersion > PG_INTEGER_MAX
  ) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.SCHEMA_VERSION_NOT_INTEGER_IN_PG_INTEGER_RANGE,
    }
  }
  if (!isNonEmptyString(candidate.promptVersion)) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.PROMPT_VERSION_EMPTY,
    }
  }
  if (!isNonEmptyString(candidate.model)) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.MODEL_EMPTY,
    }
  }
  if (!isNonEmptyString(candidate.provider)) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.PROVIDER_EMPTY,
    }
  }

  return {
    kind: "ok",
    config: {
      schemaVersion: candidate.schemaVersion,
      promptVersion: candidate.promptVersion,
      model: candidate.model,
      provider: candidate.provider,
    },
  }
}

export const isValidDialogMemoryToken = (
  input: unknown,
): input is DialogMemoryToken => {
  if (typeof input !== "object" || input === null) {
    return false
  }
  const candidate = input as {
    sourceRevision?: unknown
    memoryVersion?: unknown
    topologyEpoch?: unknown
  }
  return (
    isCanonicalNonnegativeBigint(candidate.sourceRevision) &&
    isCanonicalPositiveBigint(candidate.memoryVersion) &&
    isCanonicalNonnegativeBigint(candidate.topologyEpoch)
  )
}

export type DialogMemoryCursor = {
  id: string
  createdAtMicros: string
}

export type DialogMemoryMessageDto = {
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
  attachments: DialogMemoryAttachmentDto[]
}

export type DialogMemoryAttachmentDto = {
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

export type DialogMemorySnapshotResult =
  | {
      kind: "ok"
      scope: DialogMemoryScope
      token: DialogMemoryToken
      memory: DialogMemoryDto
      items: DialogMemoryMessageDto[]
      hasMore: boolean
      nextCursor: DialogMemoryCursor | null
    }
  | { kind: "not_found"; reason: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "inconsistent"; reason: string }
  | { kind: "unregistered"; reason: string }
  | { kind: "conflict"; reason: string }
  | { kind: "invalid"; reason: string }
  | { kind: "unavailable"; reason: string }

const MICROSECOND_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999) return false
  if (month < 1 || month > 12) return false
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  return day >= 1 && day <= daysInMonth[month - 1]
}

function isValidMicrosecondUtc(value: unknown): value is string {
  if (typeof value !== "string") return false
  if (!MICROSECOND_UTC_RE.test(value)) return false

  const [datePart, timePart] = value.split("T")
  const [yearStr, monthStr, dayStr] = datePart.split("-")
  const [hourStr, minuteStr, secondStr] = timePart.slice(0, 8).split(":")

  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const hour = Number(hourStr)
  const minute = Number(minuteStr)
  const second = Number(secondStr)

  if (!isValidCalendarDate(year, month, day)) return false
  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return false
  }

  return true
}

export type ValidatedSnapshotRequest = {
  scope: DialogMemoryScope
  limit: number
  cursor?: DialogMemoryCursor
  expectedToken?: DialogMemoryToken
}

export type DialogMemorySnapshotInputValidationResult =
  | { kind: "ok"; value: ValidatedSnapshotRequest }
  | { kind: "invalid"; reason: string }

export const validateDialogMemorySnapshotInput = (
  input: unknown,
): DialogMemorySnapshotInputValidationResult => {
  if (typeof input !== "object" || input === null) {
    return {
      kind: "invalid",
      reason:
        DIALOG_MEMORY_REASONS.INVALID
          .WORKSPACE_ID_NOT_CANONICAL_POSITIVE_BIGINT,
    }
  }

  const candidate = input as {
    scope?: unknown
    limit?: unknown
    cursor?: unknown
    expectedToken?: unknown
  }

  const scopeResult = validateDialogMemoryScope(candidate.scope)
  if (scopeResult.kind === "invalid") {
    return scopeResult
  }

  let limit = 100
  if (candidate.limit !== undefined && candidate.limit !== null) {
    if (
      typeof candidate.limit !== "number" ||
      !Number.isSafeInteger(candidate.limit) ||
      candidate.limit < 1 ||
      candidate.limit > 200
    ) {
      return {
        kind: "invalid",
        reason: DIALOG_MEMORY_REASONS.INVALID.LIMIT_NOT_INTEGER_1_TO_200,
      }
    }
    limit = candidate.limit
  }

  let cursor: DialogMemoryCursor | undefined
  if (candidate.cursor !== undefined && candidate.cursor !== null) {
    if (typeof candidate.cursor !== "object" || candidate.cursor === null) {
      return {
        kind: "invalid",
        reason: DIALOG_MEMORY_REASONS.INVALID.CURSOR_DATE_NOT_MICROSECOND_UTC,
      }
    }

    const cursorCandidate = candidate.cursor as {
      id?: unknown
      createdAtMicros?: unknown
    }

    if (!isCanonicalPositiveBigint(cursorCandidate.id)) {
      return {
        kind: "invalid",
        reason:
          DIALOG_MEMORY_REASONS.INVALID
            .CURSOR_ID_NOT_CANONICAL_POSITIVE_BIGINT,
      }
    }

    if (!isValidMicrosecondUtc(cursorCandidate.createdAtMicros)) {
      return {
        kind: "invalid",
        reason: DIALOG_MEMORY_REASONS.INVALID.CURSOR_DATE_NOT_MICROSECOND_UTC,
      }
    }

    cursor = {
      id: cursorCandidate.id,
      createdAtMicros: cursorCandidate.createdAtMicros,
    }
  }

  let expectedToken: DialogMemoryToken | undefined
  if (candidate.expectedToken !== undefined && candidate.expectedToken !== null) {
    if (!isValidDialogMemoryToken(candidate.expectedToken)) {
      return {
        kind: "invalid",
        reason: DIALOG_MEMORY_REASONS.INVALID.EXPECTED_TOKEN_NOT_VALID,
      }
    }
    expectedToken = {
      sourceRevision: candidate.expectedToken.sourceRevision,
      memoryVersion: candidate.expectedToken.memoryVersion,
      topologyEpoch: candidate.expectedToken.topologyEpoch,
    }
  }

  if (cursor !== undefined && expectedToken === undefined) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.MISSING_EXPECTED_TOKEN_WITH_CURSOR,
    }
  }

  return {
    kind: "ok",
    value: {
      scope: scopeResult.scope,
      limit,
      cursor,
      expectedToken,
    },
  }
}
