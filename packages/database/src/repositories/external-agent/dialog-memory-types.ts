/**
 * Pure types, DTOs and runtime validators for dialog memory.
 *
 * This module intentionally imports no database runtime (no `db`, no pools,
 * no queries) so it can be imported anywhere without booting a connection.
 */

const PG_BIGINT_MAX = 9223372036854775807n
const PG_INTEGER_MAX = 2147483647

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
  },
  NOT_FOUND: {
    CONVERSATION: "conversation not found or contact mismatch",
  },
  UNSUPPORTED: {
    MESSAGE_SHARDED:
      "message sharding is not supported for dialog memory scope v1",
    RETENTION_JOB:
      "unsupported TimescaleDB job on Message or Attachment",
  },
  INCONSISTENT: {
    SOURCE_WITHOUT_MEMORY: "DialogMemorySource exists without DialogMemory",
    MEMORY_WITHOUT_SOURCE: "DialogMemory exists without DialogMemorySource",
    PARTIAL_INSERT: "partial source/memory insert detected",
  },
  UNAVAILABLE: {
    GLOBAL_TOPOLOGY_MISSING: "global dialog memory topology singleton is missing",
    RETENTION_QUERY_FAILED: "failed to query timescaledb retention metadata",
    TRANSACTION_RETRY_EXHAUSTED: "transaction retry exhausted",
    TRANSACTION_FAILED: "transaction failed",
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

const isCanonicalNonnegativeBigint = (value: unknown): value is string =>
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
