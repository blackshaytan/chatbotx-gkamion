/**
 * Pure types, DTOs and runtime validators for dialog memory.
 *
 * This module intentionally imports no database runtime (no `db`, no pools,
 * no queries) so it can be imported anywhere without booting a connection.
 */

const PG_BIGINT_MAX = 9223372036854775807n
const PG_INTEGER_MAX = 2_147_483_647

/** Inclusive page size bounds from the T04 snapshot contract. */
export const DIALOG_MEMORY_PAGE_LIMIT_MIN = 1
export const DIALOG_MEMORY_PAGE_LIMIT_MAX = 200

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
    EXPECTED_TOKEN_NOT_VALID:
      "expectedToken is not a valid dialog memory token",
    MISSING_EXPECTED_TOKEN_WITH_CURSOR:
      "expectedToken is required when cursor is provided",
    CURSOR_ANCHOR_NOT_IN_SCOPE: "cursor anchor does not belong to this scope",
    COVERAGE_NOT_IN_SCOPE:
      "coverage cursor does not point to a message in this scope",
    COVERAGE_MUST_BE_NULL_OR_CURSOR: "coverage must be null or a valid cursor",
    SUMMARY_NOT_JSON_OBJECT: "summary must be a plain JSON object",
    SUMMARY_DEPTH_EXCEEDED: "summary exceeds the maximum nesting depth",
    SUMMARY_PAYLOAD_TOO_LARGE:
      "summary payload exceeds the supported size limit",
    SUMMARY_INVALID_VALUE:
      "summary contains a value that is not JSON-serializable",
    PUBLISH_INPUT_INVALID: "publish input is not a valid object",
    RESET_INPUT_INVALID: "reset input is not a valid object",
  },
  NOT_FOUND: {
    CONVERSATION: "conversation not found or contact mismatch",
  },
  UNSUPPORTED: {
    MESSAGE_SHARDED:
      "message sharding is not supported for dialog memory scope v1",
    RETENTION_JOB: "unsupported TimescaleDB job on Message or Attachment",
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
    GLOBAL_TOPOLOGY_MISSING:
      "global dialog memory topology singleton is missing",
    RETENTION_QUERY_FAILED: "failed to query timescaledb retention metadata",
    TRANSACTION_RETRY_EXHAUSTED: "transaction retry exhausted",
    TRANSACTION_FAILED: "transaction failed",
    HISTORY_PREFLIGHT_INVALID:
      "history page preflight metadata is invalid or unavailable",
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
      reason:
        DIALOG_MEMORY_REASONS.INVALID
          .WORKSPACE_ID_NOT_CANONICAL_POSITIVE_BIGINT,
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
      reason:
        DIALOG_MEMORY_REASONS.INVALID
          .WORKSPACE_ID_NOT_CANONICAL_POSITIVE_BIGINT,
    }
  }
  if (!isCanonicalPositiveBigint(candidate.conversationId)) {
    return {
      kind: "invalid",
      reason:
        DIALOG_MEMORY_REASONS.INVALID
          .CONVERSATION_ID_NOT_CANONICAL_POSITIVE_BIGINT,
    }
  }
  if (!isCanonicalPositiveBigint(candidate.expectedContactId)) {
    return {
      kind: "invalid",
      reason:
        DIALOG_MEMORY_REASONS.INVALID
          .EXPECTED_CONTACT_ID_NOT_CANONICAL_POSITIVE_BIGINT,
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
      reason:
        DIALOG_MEMORY_REASONS.INVALID
          .SCHEMA_VERSION_NOT_INTEGER_IN_PG_INTEGER_RANGE,
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
      reason:
        DIALOG_MEMORY_REASONS.INVALID
          .SCHEMA_VERSION_NOT_INTEGER_IN_PG_INTEGER_RANGE,
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

function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (year < 1 || year > 9999) {
    return false
  }
  if (month < 1 || month > 12) {
    return false
  }
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
  if (typeof value !== "string") {
    return false
  }
  if (!MICROSECOND_UTC_RE.test(value)) {
    return false
  }

  const [datePart, timePart] = value.split("T")
  const [yearStr, monthStr, dayStr] = datePart.split("-")
  const [hourStr, minuteStr, secondStr] = timePart.slice(0, 8).split(":")

  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const hour = Number(hourStr)
  const minute = Number(minuteStr)
  const second = Number(secondStr)

  if (!isValidCalendarDate(year, month, day)) {
    return false
  }
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
          DIALOG_MEMORY_REASONS.INVALID.CURSOR_ID_NOT_CANONICAL_POSITIVE_BIGINT,
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
  if (
    candidate.expectedToken !== undefined &&
    candidate.expectedToken !== null
  ) {
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

export type DialogMemoryPublishInput = {
  scope: DialogMemoryScope
  expectedToken: DialogMemoryToken
  summary: unknown
  coverage: DialogMemoryCursor | null
  config: DialogMemoryConfig
}

export type DialogMemoryResetInput = {
  scope: DialogMemoryScope
  expectedToken: DialogMemoryToken
}

export type DialogMemoryPublishResult =
  | {
      kind: "ok"
      token: DialogMemoryToken
      memory: DialogMemoryDto
    }
  | { kind: "conflict"; reason: string }
  | { kind: "unregistered"; reason: string }
  | { kind: "inconsistent"; reason: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "not_found"; reason: string }
  | { kind: "invalid"; reason: string }
  | { kind: "unavailable"; reason: string }

export type DialogMemoryResetResult =
  | {
      kind: "ok"
      token: DialogMemoryToken
      memory: DialogMemoryDto
    }
  | { kind: "conflict"; reason: string }
  | { kind: "unregistered"; reason: string }
  | { kind: "inconsistent"; reason: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "not_found"; reason: string }
  | { kind: "invalid"; reason: string }
  | { kind: "unavailable"; reason: string }

export type DialogMemoryPublishInputValidationResult =
  | {
      kind: "ok"
      value: {
        scope: DialogMemoryScope
        expectedToken: DialogMemoryToken
        summaryJson: string
        coverage: DialogMemoryCursor | null
        config: DialogMemoryConfig
      }
    }
  | { kind: "invalid"; reason: string }

export type DialogMemoryResetInputValidationResult =
  | {
      kind: "ok"
      value: {
        scope: DialogMemoryScope
        expectedToken: DialogMemoryToken
      }
    }
  | { kind: "invalid"; reason: string }

const MAX_SUMMARY_DEPTH = 32
const MAX_SUMMARY_BYTES = 8 * 1024 * 1024

class SummaryValidationError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super("summary-validation-error")
    this.name = "SummaryValidationError"
    this.reason = reason
  }
}

function failSummary(reason: string): never {
  throw new SummaryValidationError(reason)
}

function escapeJsonString(value: string): string {
  let result = '"'
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code === 0x22) {
      result += '\\"'
    } else if (code === 0x5c) {
      result += "\\\\"
    } else if (code < 0x20) {
      result += `\\u${code.toString(16).padStart(4, "0")}`
    } else {
      result += char
    }
  }
  result += '"'
  return result
}

type JsonWriter = {
  parts: string[]
  bytes: number
  encoder: TextEncoder
}

function appendToWriter(writer: JsonWriter, part: string): void {
  writer.parts.push(part)
  writer.bytes += writer.encoder.encode(part).length
  if (writer.bytes > MAX_SUMMARY_BYTES) {
    failSummary(DIALOG_MEMORY_REASONS.INVALID.SUMMARY_PAYLOAD_TOO_LARGE)
  }
}

function writeJsonValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  writer: JsonWriter,
): void {
  if (depth > MAX_SUMMARY_DEPTH) {
    failSummary(DIALOG_MEMORY_REASONS.INVALID.SUMMARY_DEPTH_EXCEEDED)
  }

  switch (typeof value) {
    case "string": {
      appendToWriter(writer, escapeJsonString(value))
      return
    }
    case "number": {
      if (!Number.isFinite(value)) {
        failSummary(DIALOG_MEMORY_REASONS.INVALID.SUMMARY_INVALID_VALUE)
      }
      appendToWriter(writer, String(value))
      return
    }
    case "boolean": {
      appendToWriter(writer, value ? "true" : "false")
      return
    }
    case "object": {
      if (value === null) {
        appendToWriter(writer, "null")
        return
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          appendToWriter(writer, "[]")
          return
        }
        if (seen.has(value)) {
          failSummary(DIALOG_MEMORY_REASONS.INVALID.SUMMARY_INVALID_VALUE)
        }
        seen.add(value)
        appendToWriter(writer, "[")
        for (let i = 0; i < value.length; i++) {
          if (!(i in value)) {
            failSummary(DIALOG_MEMORY_REASONS.INVALID.SUMMARY_INVALID_VALUE)
          }
          if (i > 0) {
            appendToWriter(writer, ",")
          }
          writeJsonValue(value[i], depth + 1, seen, writer)
        }
        appendToWriter(writer, "]")
        seen.delete(value)
        return
      }

      if (seen.has(value)) {
        failSummary(DIALOG_MEMORY_REASONS.INVALID.SUMMARY_INVALID_VALUE)
      }

      const prototype = Object.getPrototypeOf(value)
      if (prototype !== null && prototype !== Object.prototype) {
        failSummary(DIALOG_MEMORY_REASONS.INVALID.SUMMARY_INVALID_VALUE)
      }

      if (Object.getOwnPropertySymbols(value).length > 0) {
        failSummary(DIALOG_MEMORY_REASONS.INVALID.SUMMARY_INVALID_VALUE)
      }

      const keys = Object.keys(value)
      if (keys.length === 0) {
        appendToWriter(writer, "{}")
        return
      }

      seen.add(value)
      appendToWriter(writer, "{")
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (
          descriptor === undefined ||
          "get" in descriptor ||
          "set" in descriptor
        ) {
          failSummary(DIALOG_MEMORY_REASONS.INVALID.SUMMARY_INVALID_VALUE)
        }
        if (i > 0) {
          appendToWriter(writer, ",")
        }
        appendToWriter(writer, escapeJsonString(key))
        appendToWriter(writer, ":")
        writeJsonValue(descriptor.value, depth + 1, seen, writer)
      }
      appendToWriter(writer, "}")
      seen.delete(value)
      return
    }
    default: {
      failSummary(DIALOG_MEMORY_REASONS.INVALID.SUMMARY_INVALID_VALUE)
    }
  }
}

export type DialogMemorySummaryValidationResult =
  | { kind: "ok"; summaryJson: string }
  | { kind: "invalid"; reason: string }

export const validateDialogMemorySummary = (
  input: unknown,
): DialogMemorySummaryValidationResult => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.SUMMARY_NOT_JSON_OBJECT,
    }
  }

  const prototype = Object.getPrototypeOf(input)
  if (prototype !== null && prototype !== Object.prototype) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.SUMMARY_NOT_JSON_OBJECT,
    }
  }

  try {
    const writer: JsonWriter = {
      parts: [],
      bytes: 0,
      encoder: new TextEncoder(),
    }
    writeJsonValue(input, 1, new WeakSet(), writer)
    return {
      kind: "ok",
      summaryJson: writer.parts.join(""),
    }
  } catch (error) {
    if (error instanceof SummaryValidationError) {
      return { kind: "invalid", reason: error.reason }
    }
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.SUMMARY_INVALID_VALUE,
    }
  }
}

export const validateDialogMemoryPublishInput = (
  input: unknown,
): DialogMemoryPublishInputValidationResult => {
  if (typeof input !== "object" || input === null) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.PUBLISH_INPUT_INVALID,
    }
  }

  const candidate = input as {
    scope?: unknown
    expectedToken?: unknown
    summary?: unknown
    coverage?: unknown
    config?: unknown
  }

  const scopeResult = validateDialogMemoryScope(candidate.scope)
  if (scopeResult.kind === "invalid") {
    return scopeResult
  }

  if (!isValidDialogMemoryToken(candidate.expectedToken)) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.EXPECTED_TOKEN_NOT_VALID,
    }
  }
  const expectedToken: DialogMemoryToken = {
    sourceRevision: candidate.expectedToken.sourceRevision,
    memoryVersion: candidate.expectedToken.memoryVersion,
    topologyEpoch: candidate.expectedToken.topologyEpoch,
  }

  const summaryResult = validateDialogMemorySummary(candidate.summary)
  if (summaryResult.kind === "invalid") {
    return summaryResult
  }

  if (candidate.coverage === undefined) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.COVERAGE_MUST_BE_NULL_OR_CURSOR,
    }
  }

  let coverage: DialogMemoryCursor | null = null
  if (candidate.coverage !== null) {
    if (typeof candidate.coverage !== "object" || candidate.coverage === null) {
      return {
        kind: "invalid",
        reason: DIALOG_MEMORY_REASONS.INVALID.CURSOR_DATE_NOT_MICROSECOND_UTC,
      }
    }
    const cursorCandidate = candidate.coverage as {
      id?: unknown
      createdAtMicros?: unknown
    }
    if (!isCanonicalPositiveBigint(cursorCandidate.id)) {
      return {
        kind: "invalid",
        reason:
          DIALOG_MEMORY_REASONS.INVALID.CURSOR_ID_NOT_CANONICAL_POSITIVE_BIGINT,
      }
    }
    if (!isValidMicrosecondUtc(cursorCandidate.createdAtMicros)) {
      return {
        kind: "invalid",
        reason: DIALOG_MEMORY_REASONS.INVALID.CURSOR_DATE_NOT_MICROSECOND_UTC,
      }
    }
    coverage = {
      id: cursorCandidate.id,
      createdAtMicros: cursorCandidate.createdAtMicros,
    }
  }

  const configResult = validateDialogMemoryConfig(candidate.config)
  if (configResult.kind === "invalid") {
    return configResult
  }

  return {
    kind: "ok",
    value: {
      scope: scopeResult.scope,
      expectedToken,
      summaryJson: summaryResult.summaryJson,
      coverage,
      config: configResult.config,
    },
  }
}

export const validateDialogMemoryResetInput = (
  input: unknown,
): DialogMemoryResetInputValidationResult => {
  if (typeof input !== "object" || input === null) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.RESET_INPUT_INVALID,
    }
  }

  const candidate = input as {
    scope?: unknown
    expectedToken?: unknown
  }

  const scopeResult = validateDialogMemoryScope(candidate.scope)
  if (scopeResult.kind === "invalid") {
    return scopeResult
  }

  if (!isValidDialogMemoryToken(candidate.expectedToken)) {
    return {
      kind: "invalid",
      reason: DIALOG_MEMORY_REASONS.INVALID.EXPECTED_TOKEN_NOT_VALID,
    }
  }
  const expectedToken: DialogMemoryToken = {
    sourceRevision: candidate.expectedToken.sourceRevision,
    memoryVersion: candidate.expectedToken.memoryVersion,
    topologyEpoch: candidate.expectedToken.topologyEpoch,
  }

  return {
    kind: "ok",
    value: {
      scope: scopeResult.scope,
      expectedToken,
    },
  }
}
