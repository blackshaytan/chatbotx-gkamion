/**
 * Pure coverage/manifest helpers for dialog memory.
 *
 * No IO, no DB imports, no Date/Number IDs. The module only computes stable
 * fingerprints, manifests, and a plain JSON storage record. It is not wired
 * into any service or API yet.
 */

import { createHash } from "node:crypto"
import type {
  DialogMemoryAttachmentDto,
  DialogMemoryConfig,
  DialogMemoryMessageDto,
  DialogMemoryScope,
} from "@chatbotx.io/database/repositories"

export type MessageRef = {
  id: string
  createdAtMicros: string
}

export type FingerprintedRef = MessageRef & {
  fingerprint: string
}

export const MESSAGE_REF_FORMAT_VERSION = 1 as const
export const STORAGE_VERSION = 1 as const
export const MANIFEST_VERSION = 1 as const

export type StoredDialogMemoryRecord = {
  storageVersion: 1
  manifestVersion: 1
  validatorVersion: string
  scope: DialogMemoryScope
  config: DialogMemoryConfig
  coverage: MessageRef | null
  coveredManifest: FingerprintedRef[]
  payload: unknown
}

export type ManifestDiff =
  | {
      kind: "append"
      coveredCount: number
      uncovered: readonly DialogMemoryMessageDto[]
    }
  | {
      kind: "rebuild"
      reason:
        | "missing_or_backdated"
        | "fingerprint_mismatch"
        | "order_violation"
    }

const PG_BIGINT_MAX = 9223372036854775807n
const PG_INTEGER_MAX = 2_147_483_647

const CANONICAL_POSITIVE_BIGINT_RE = /^[1-9]\d*$/
const MICROSECOND_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const SHA256_HEX_RE = /^[0-9a-f]{64}$/

const R = {
  NOT_A_PLAIN_OBJECT: "not_a_plain_object",
  UNSUPPORTED_STORAGE_VERSION: "unsupported_storage_version",
  UNSUPPORTED_MANIFEST_VERSION: "unsupported_manifest_version",
  EMPTY_VALIDATOR_VERSION: "empty_validator_version",
  INVALID_SCOPE: "invalid_scope",
  INVALID_CONFIG: "invalid_config",
  MANIFEST_NOT_ARRAY: "manifest_not_array",
  INVALID_MANIFEST_REF: "invalid_manifest_ref",
  MANIFEST_ORDER_VIOLATION: "manifest_order_violation",
  MISSING_COVERAGE: "missing_coverage",
  COVERAGE_MISMATCH: "coverage_mismatch",
  INVALID_COVERAGE: "invalid_coverage",
  INVALID_PAYLOAD: "invalid_payload",
  NON_JSON_VALUE: "non_json_value",
  CYCLE_DETECTED: "cycle_detected",
  ORDER_VIOLATION: "order_violation",
} as const

class CoverageValidationError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`coverage-validation-error: ${reason}`)
    this.name = "CoverageValidationError"
    this.reason = reason
  }
}

const fail = (reason: string): never => {
  throw new CoverageValidationError(reason)
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0

const isCanonicalPositiveBigint = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !CANONICAL_POSITIVE_BIGINT_RE.test(value) ||
    value.length > 19
  ) {
    return false
  }
  return BigInt(value) <= PG_BIGINT_MAX
}

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const isValidCalendarDate = (
  year: number,
  month: number,
  day: number,
): boolean => {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false
  }
  const days = [
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
  return day <= days[month - 1]
}

const isValidMicrosecondUtc = (value: unknown): value is string => {
  if (typeof value !== "string" || !MICROSECOND_UTC_RE.test(value)) {
    return false
  }
  const [datePart, timePart] = value.split("T")
  const [y, m, d] = datePart.split("-").map(Number)
  const [h, min, s] = timePart.slice(0, 8).split(":").map(Number)
  if (
    !isValidCalendarDate(y, m, d) ||
    h < 0 ||
    h > 23 ||
    min < 0 ||
    min > 59 ||
    s < 0 ||
    s > 59
  ) {
    return false
  }
  return true
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || prototype === Object.prototype
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[]

const cloneJson = (value: unknown, seen: WeakSet<object>): JsonValue => {
  switch (typeof value) {
    case "string":
      return value
    case "number": {
      if (!Number.isFinite(value)) {
        fail(R.NON_JSON_VALUE)
      }
      return value
    }
    case "boolean":
      return value
    case "object": {
      if (value === null) {
        return null
      }
      if (Array.isArray(value)) {
        if (seen.has(value)) {
          fail(R.CYCLE_DETECTED)
        }
        seen.add(value)
        if (Object.getOwnPropertySymbols(value).length > 0) {
          fail(R.NON_JSON_VALUE)
        }
        const descriptors = Object.getOwnPropertyDescriptors(value)
        for (const name of Object.getOwnPropertyNames(value)) {
          if (name === "length") {
            continue
          }
          const index = Number(name)
          if (
            !(
              String(index) === name &&
              Number.isInteger(index) &&
              index >= 0 &&
              index < value.length
            )
          ) {
            fail(R.NON_JSON_VALUE)
          }
        }
        const out: JsonValue[] = []
        for (let i = 0; i < value.length; i++) {
          const descriptor = descriptors[String(i)]
          if (!(descriptor && "value" in descriptor && descriptor.enumerable)) {
            fail(R.NON_JSON_VALUE)
          }
          out.push(cloneJson(descriptor.value, seen))
        }
        seen.delete(value)
        return out
      }
      if (!isPlainObject(value)) {
        fail(R.NON_JSON_VALUE)
      }
      if (seen.has(value)) {
        fail(R.CYCLE_DETECTED)
      }
      seen.add(value)
      if (Object.getOwnPropertySymbols(value).length > 0) {
        fail(R.NON_JSON_VALUE)
      }
      const out: Record<string, JsonValue> = {}
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor) {
          fail(R.NON_JSON_VALUE)
        }
        if (
          !(descriptor.enumerable && "value" in descriptor) ||
          descriptor.get ||
          descriptor.set
        ) {
          fail(R.NON_JSON_VALUE)
        }
        Object.defineProperty(out, key, {
          value: cloneJson(descriptor.value, seen),
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
      seen.delete(value)
      return out
    }
    default:
      fail(R.NON_JSON_VALUE)
  }
}

const asJsonObject = (value: JsonValue): Record<string, JsonValue> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(R.NON_JSON_VALUE)
  }
  return value as Record<string, JsonValue>
}

const escapeJsonString = (value: string): string => JSON.stringify(value)

const compareUtf16 = (a: string, b: string): number => {
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}

const writeCanonicalJson = (value: JsonValue, parts: string[]): void => {
  switch (typeof value) {
    case "string":
      parts.push(escapeJsonString(value))
      return
    case "number":
      parts.push(String(value))
      return
    case "boolean":
      parts.push(value ? "true" : "false")
      return
    case "object": {
      if (value === null) {
        parts.push("null")
        return
      }
      if (Array.isArray(value)) {
        parts.push("[")
        for (let i = 0; i < value.length; i++) {
          if (i > 0) {
            parts.push(",")
          }
          writeCanonicalJson(value[i], parts)
        }
        parts.push("]")
        return
      }
      const keys = Object.keys(value).sort(compareUtf16)
      parts.push("{")
      for (let i = 0; i < keys.length; i++) {
        if (i > 0) {
          parts.push(",")
        }
        parts.push(escapeJsonString(keys[i]), ":")
        writeCanonicalJson(value[keys[i]], parts)
      }
      parts.push("}")
      return
    }
    default:
      fail(R.NON_JSON_VALUE)
  }
}

const canonicalJsonString = (value: JsonValue): string => {
  const parts: string[] = []
  writeCanonicalJson(value, parts)
  return parts.join("")
}

const fingerprintCanonical = (value: JsonValue): string => {
  const hash = createHash("sha256")
  hash.update(canonicalJsonString(value), "utf8")
  return hash.digest("hex")
}

const attachmentCanonical = (attachment: unknown): JsonValue => {
  const cloned = asJsonObject(cloneJson(attachment, new WeakSet()))
  return {
    id: cloned.id,
    createdAtMicros: cloned.createdAtMicros,
    workspaceId: cloned.workspaceId,
    conversationId: cloned.conversationId,
    messageId: cloned.messageId,
    messageCreatedAtMicros: cloned.messageCreatedAtMicros,
    fileType: cloned.fileType,
    sourceId: cloned.sourceId,
    mimeType: cloned.mimeType,
    width: cloned.width,
    height: cloned.height,
    size: cloned.size,
    thumbnailPath: cloned.thumbnailPath,
    originPath: cloned.originPath,
    name: cloned.name,
  }
}

const validateMessageRef = (ref: MessageRef): void => {
  if (
    !(
      isCanonicalPositiveBigint(ref.id) &&
      isValidMicrosecondUtc(ref.createdAtMicros)
    )
  ) {
    fail(R.INVALID_MANIFEST_REF)
  }
}

export const compareRefsAsc = (a: MessageRef, b: MessageRef): number => {
  validateMessageRef(a)
  validateMessageRef(b)
  if (a.createdAtMicros !== b.createdAtMicros) {
    return a.createdAtMicros < b.createdAtMicros ? -1 : 1
  }
  const aId = BigInt(a.id)
  const bId = BigInt(b.id)
  if (aId === bId) {
    return 0
  }
  return aId < bId ? -1 : 1
}

export const attachmentFingerprint = (
  attachment: DialogMemoryAttachmentDto,
): string => fingerprintCanonical(attachmentCanonical(attachment))

export const messageFingerprint = (message: DialogMemoryMessageDto): string => {
  const cloned = asJsonObject(cloneJson(message, new WeakSet()))
  const attachments = cloned.attachments
  if (!Array.isArray(attachments)) {
    fail(R.NON_JSON_VALUE)
  }
  const attachmentItems = attachments as JsonValue[]
  const sortedAttachments = [...attachmentItems].sort((a, b) =>
    compareRefsAsc(a as MessageRef, b as MessageRef),
  )
  const canonicalMessage: JsonValue = {
    id: cloned.id,
    createdAtMicros: cloned.createdAtMicros,
    conversationId: cloned.conversationId,
    contactInboxId: cloned.contactInboxId,
    workspaceId: cloned.workspaceId,
    text: cloned.text,
    contentAttributes: cloned.contentAttributes,
    messageType: cloned.messageType,
    contentType: cloned.contentType,
    senderType: cloned.senderType,
    senderId: cloned.senderId,
    sourceId: cloned.sourceId,
    deletedAtMicros: cloned.deletedAtMicros,
    type: cloned.type,
    parentId: cloned.parentId,
    attributes: cloned.attributes,
    sendError: cloned.sendError,
    attachments: sortedAttachments.map((a) => attachmentCanonical(a)),
  }
  return fingerprintCanonical(canonicalMessage)
}

export const buildFingerprintedRef = (
  message: DialogMemoryMessageDto,
): FingerprintedRef => ({
  id: message.id,
  createdAtMicros: message.createdAtMicros,
  fingerprint: messageFingerprint(message),
})

const assertStrictAscUniqueRefs = (items: readonly MessageRef[]): void => {
  for (const item of items) {
    validateMessageRef(item)
  }
  for (let i = 1; i < items.length; i++) {
    if (compareRefsAsc(items[i - 1], items[i]) >= 0) {
      fail(R.ORDER_VIOLATION)
    }
  }
}

const assertStrictAscUniqueMessages = (
  items: readonly DialogMemoryMessageDto[],
): void => {
  for (const item of items) {
    validateMessageRef({ id: item.id, createdAtMicros: item.createdAtMicros })
  }
  for (let i = 1; i < items.length; i++) {
    if (compareRefsAsc(items[i - 1], items[i]) >= 0) {
      fail(R.ORDER_VIOLATION)
    }
  }
}

export const buildManifest = (
  ascItems: readonly DialogMemoryMessageDto[],
): FingerprintedRef[] => {
  assertStrictAscUniqueMessages(ascItems)
  return ascItems.map((item) => buildFingerprintedRef(item))
}

export const diffManifest = (
  coveredManifest: readonly FingerprintedRef[],
  ascItems: readonly DialogMemoryMessageDto[],
): ManifestDiff => {
  try {
    assertStrictAscUniqueRefs(coveredManifest)
    assertStrictAscUniqueMessages(ascItems)
  } catch {
    return { kind: "rebuild", reason: "order_violation" }
  }

  if (coveredManifest.length === 0) {
    return { kind: "append", coveredCount: 0, uncovered: [...ascItems] }
  }
  if (ascItems.length === 0) {
    return { kind: "rebuild", reason: "missing_or_backdated" }
  }

  for (let i = 0; i < coveredManifest.length; i++) {
    const covered = coveredManifest[i]
    if (i >= ascItems.length) {
      return { kind: "rebuild", reason: "missing_or_backdated" }
    }
    const current = ascItems[i]
    if (
      covered.id !== current.id ||
      covered.createdAtMicros !== current.createdAtMicros
    ) {
      return { kind: "rebuild", reason: "missing_or_backdated" }
    }
    if (covered.fingerprint !== messageFingerprint(current)) {
      return { kind: "rebuild", reason: "fingerprint_mismatch" }
    }
  }

  return {
    kind: "append",
    coveredCount: coveredManifest.length,
    uncovered: ascItems.slice(coveredManifest.length),
  }
}

export const coverageRefOf = (
  manifest: readonly FingerprintedRef[],
): MessageRef | null => {
  if (manifest.length === 0) {
    return null
  }
  const last = manifest.at(-1)
  if (last === undefined) {
    fail(R.MANIFEST_ORDER_VIOLATION)
  }
  return { id: last.id, createdAtMicros: last.createdAtMicros }
}

export const isFullCoverage = (
  manifest: readonly FingerprintedRef[],
  ascItems: readonly DialogMemoryMessageDto[],
): boolean => {
  const diff = diffManifest(manifest, ascItems)
  return diff.kind === "append" && diff.uncovered.length === 0
}

const validateScope = (value: unknown): DialogMemoryScope => {
  if (!isPlainObject(value)) {
    fail(R.INVALID_SCOPE)
  }
  const candidate = value as {
    workspaceId?: unknown
    conversationId?: unknown
    expectedContactId?: unknown
  }
  if (
    !(
      isCanonicalPositiveBigint(candidate.workspaceId) &&
      isCanonicalPositiveBigint(candidate.conversationId) &&
      isCanonicalPositiveBigint(candidate.expectedContactId)
    )
  ) {
    fail(R.INVALID_SCOPE)
  }
  return {
    workspaceId: String(candidate.workspaceId),
    conversationId: String(candidate.conversationId),
    expectedContactId: String(candidate.expectedContactId),
  }
}

const validateConfig = (value: unknown): DialogMemoryConfig => {
  if (!isPlainObject(value)) {
    fail(R.INVALID_CONFIG)
  }
  const candidate = value as {
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
    fail(R.INVALID_CONFIG)
  }
  if (
    !(
      isNonEmptyString(candidate.promptVersion) &&
      isNonEmptyString(candidate.model) &&
      isNonEmptyString(candidate.provider)
    )
  ) {
    fail(R.INVALID_CONFIG)
  }
  return {
    schemaVersion: candidate.schemaVersion,
    promptVersion: String(candidate.promptVersion),
    model: String(candidate.model),
    provider: String(candidate.provider),
  }
}

const validateFingerprintedRef = (value: unknown): FingerprintedRef => {
  if (!isPlainObject(value)) {
    fail(R.INVALID_MANIFEST_REF)
  }
  const candidate = value as {
    id?: unknown
    createdAtMicros?: unknown
    fingerprint?: unknown
  }
  if (
    !(
      isCanonicalPositiveBigint(candidate.id) &&
      isValidMicrosecondUtc(candidate.createdAtMicros) &&
      isNonEmptyString(candidate.fingerprint) &&
      SHA256_HEX_RE.test(candidate.fingerprint)
    )
  ) {
    fail(R.INVALID_MANIFEST_REF)
  }
  return {
    id: String(candidate.id),
    createdAtMicros: String(candidate.createdAtMicros),
    fingerprint: String(candidate.fingerprint),
  }
}

const validateCoveredManifest = (value: unknown): FingerprintedRef[] => {
  if (!Array.isArray(value)) {
    fail(R.MANIFEST_NOT_ARRAY)
  }
  const refs = (value as unknown[]).map((item) =>
    validateFingerprintedRef(item),
  )
  try {
    assertStrictAscUniqueRefs(refs)
  } catch {
    fail(R.MANIFEST_ORDER_VIOLATION)
  }
  return refs
}

const validateCoverage = (
  value: unknown,
  manifest: readonly FingerprintedRef[],
): MessageRef | null => {
  if (manifest.length === 0) {
    if (value !== null) {
      fail(R.COVERAGE_MISMATCH)
    }
    return null
  }
  if (!isPlainObject(value)) {
    fail(R.INVALID_COVERAGE)
  }
  const candidate = value as { id?: unknown; createdAtMicros?: unknown }
  const last = manifest.at(-1)
  if (last === undefined) {
    fail(R.MANIFEST_ORDER_VIOLATION)
  }
  if (
    candidate.id !== last.id ||
    candidate.createdAtMicros !== last.createdAtMicros ||
    !isCanonicalPositiveBigint(candidate.id) ||
    !isValidMicrosecondUtc(candidate.createdAtMicros)
  ) {
    fail(R.COVERAGE_MISMATCH)
  }
  return {
    id: String(candidate.id),
    createdAtMicros: String(candidate.createdAtMicros),
  }
}

export const decodeStoredRecord = (
  json: unknown,
):
  | { kind: "ok"; record: StoredDialogMemoryRecord }
  | { kind: "invalid"; reason: string } => {
  let detached: JsonValue
  try {
    detached = cloneJson(json, new WeakSet())
  } catch (error) {
    return {
      kind: "invalid",
      reason:
        error instanceof CoverageValidationError
          ? error.reason
          : R.NON_JSON_VALUE,
    }
  }

  if (
    typeof detached !== "object" ||
    detached === null ||
    Array.isArray(detached)
  ) {
    return { kind: "invalid", reason: R.NOT_A_PLAIN_OBJECT }
  }

  const candidate = detached as {
    storageVersion?: unknown
    manifestVersion?: unknown
    validatorVersion?: unknown
    scope?: unknown
    config?: unknown
    coverage?: unknown
    coveredManifest?: unknown
    payload?: unknown
  }

  try {
    if (candidate.storageVersion !== STORAGE_VERSION) {
      return { kind: "invalid", reason: R.UNSUPPORTED_STORAGE_VERSION }
    }
    if (candidate.manifestVersion !== MANIFEST_VERSION) {
      return { kind: "invalid", reason: R.UNSUPPORTED_MANIFEST_VERSION }
    }
    if (!isNonEmptyString(candidate.validatorVersion)) {
      return { kind: "invalid", reason: R.EMPTY_VALIDATOR_VERSION }
    }
    const scope = validateScope(candidate.scope)
    const config = validateConfig(candidate.config)
    const coveredManifest = validateCoveredManifest(candidate.coveredManifest)
    if (!("coverage" in candidate)) {
      return { kind: "invalid", reason: R.MISSING_COVERAGE }
    }
    const coverage = validateCoverage(candidate.coverage, coveredManifest)
    return {
      kind: "ok",
      record: {
        storageVersion: STORAGE_VERSION,
        manifestVersion: MANIFEST_VERSION,
        validatorVersion: candidate.validatorVersion,
        scope,
        config,
        coverage,
        coveredManifest,
        payload: candidate.payload,
      },
    }
  } catch (error) {
    return {
      kind: "invalid",
      reason:
        error instanceof CoverageValidationError
          ? error.reason
          : R.INVALID_PAYLOAD,
    }
  }
}

export const encodeStoredRecord = (
  record: StoredDialogMemoryRecord,
): unknown => {
  const decoded = decodeStoredRecord(record)
  if (decoded.kind !== "ok") {
    fail(decoded.reason)
  }
  return decoded.record
}
