import { types } from "node:util"
import type {
  DialogMemoryMessageDto,
  DialogMemoryScope,
} from "@chatbotx.io/database/repositories"
import {
  type AttributionKind,
  type MemoryAttachmentView,
  type MemoryParseOptions,
  type MemoryPayload,
  type MemoryValidationOptions,
  memoryPayloadSchema,
  type PreparedMemorySource,
  VALIDATION_LIMITS,
  type ValidationFailCode,
  type ValidationLimits,
  type ValidationLimitsOverride,
  type ValidationOutcome,
} from "./memory-contract"
import { compareRefsAsc } from "./memory-coverage"
import type { SemanticValidatorPort } from "./memory-service-types"

const NUL = String.fromCharCode(0)

// Canonical JSON array index key: "0" or a decimal without a leading zero.
const ARRAY_INDEX_KEY = /^(?:0|[1-9]\d*)$/

const resolveLimits = (
  override: ValidationLimitsOverride | undefined,
): ValidationLimits => {
  const resolved: ValidationLimits = { ...VALIDATION_LIMITS }
  if (!override) {
    return resolved
  }
  for (const key of Object.keys(override)) {
    if (!Object.hasOwn(VALIDATION_LIMITS, key)) {
      throw new RangeError(`Unknown validation limit override: ${key}`)
    }
    const limitKey = key as keyof ValidationLimits
    const value = override[limitKey]
    if (value === undefined) {
      continue
    }
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > VALIDATION_LIMITS[limitKey]
    ) {
      throw new RangeError(
        `Invalid validation limit override for ${key}: ${String(value)}`,
      )
    }
    resolved[limitKey] = value
  }
  return resolved
}

const checkStringWellFormed = (value: string): boolean => {
  if (value.includes(NUL)) {
    return false
  }
  const check = (value as unknown as { isWellFormed?: () => boolean })
    .isWellFormed
  if (typeof check !== "function") {
    return true
  }
  return check.call(value)
}

const checkDeadlineSignal = (
  deadlineAtMs: number | undefined,
  signal: AbortSignal | undefined,
  nowMs: () => number,
): ValidationFailCode | null => {
  if (signal?.aborted) {
    return "cancelled"
  }
  if (deadlineAtMs !== undefined && nowMs() >= deadlineAtMs) {
    return "deadline"
  }
  return null
}

const preflightStringValue = (value: string): ValidationFailCode | null =>
  checkStringWellFormed(value) ? null : "not_plain_json"

type CandidatePreflightContext = {
  limits: ValidationLimits
  seen: WeakSet<object>
  nodes: { count: number }
  // Incremental JSON-encoded UTF-8 measurement (values, keys, syntax
  // overhead). Compared against limits.maxCandidateUtf8Bytes.
  bytes: { total: number }
  checkClock: () => ValidationFailCode | null
}

const addBytes = (
  ctx: CandidatePreflightContext,
  amount: number,
): ValidationFailCode | null => {
  ctx.bytes.total += amount
  return ctx.bytes.total > ctx.limits.maxCandidateUtf8Bytes ? "oversize" : null
}

// Exact JSON-encoded UTF-8 size of a primitive leaf or object key.
// JSON.stringify on primitives (string/finite number/boolean/null) runs no
// object callbacks, so these bytes always equal what a full-document
// stringify emits for the same node. Never call it on candidate objects.
const encodedPrimitiveBytes = (
  value: string | number | boolean | null,
): number => Buffer.byteLength(JSON.stringify(value), "utf8")

const addStringBytes = (
  ctx: CandidatePreflightContext,
  value: string,
): ValidationFailCode | null => {
  // UTF-16 length plus quotes is a lower bound on the JSON-encoded UTF-8
  // size: cheap early guard before the exact escaped measurement.
  if (ctx.bytes.total + value.length + 2 > ctx.limits.maxCandidateUtf8Bytes) {
    return "oversize"
  }
  return addBytes(ctx, encodedPrimitiveBytes(value))
}

const preflightCandidate = (
  value: unknown,
  depth: number,
  ctx: CandidatePreflightContext,
): ValidationFailCode | null => {
  const clock = ctx.checkClock()
  if (clock) {
    return clock
  }

  if (depth > ctx.limits.maxNodeDepth) {
    return "not_plain_json"
  }

  // Node cap counts every visited JSON value, primitive leaves included.
  ctx.nodes.count++
  if (ctx.nodes.count > ctx.limits.maxNodesTotal) {
    return "not_plain_json"
  }

  // Proxy guard BEFORE any reflection: catches revoked proxies too.
  if (types.isProxy(value)) {
    return "not_plain_json"
  }

  if (typeof value === "string") {
    const stringCheck = preflightStringValue(value)
    if (stringCheck) {
      return stringCheck
    }
    return addStringBytes(ctx, value)
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "not_plain_json"
    }
    // Exact JSON text length of the finite number, never a flat estimate.
    return addBytes(ctx, encodedPrimitiveBytes(value))
  }

  if (typeof value === "boolean" || value === null) {
    // Exact JSON text length ("true"/"false"/"null"), never a flat estimate.
    return addBytes(ctx, encodedPrimitiveBytes(value))
  }

  if (typeof value !== "object") {
    return "not_plain_json"
  }

  if (ctx.seen.has(value)) {
    return "not_plain_json"
  }
  ctx.seen.add(value)

  const fail = (code: ValidationFailCode): ValidationFailCode => {
    ctx.seen.delete(value)
    return code
  }

  if (Array.isArray(value)) {
    // Bound array length before mass descriptor work.
    if (value.length > ctx.limits.maxNodesTotal) {
      return fail("not_plain_json")
    }
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return fail("not_plain_json")
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return fail("not_plain_json")
    }
    if (Object.hasOwn(value, "toJSON")) {
      return fail("not_plain_json")
    }

    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const key of Object.getOwnPropertyNames(descriptors)) {
      if (key === "length") {
        continue
      }
      if (!ARRAY_INDEX_KEY.test(key) || Number(key) >= value.length) {
        return fail("not_plain_json")
      }
      const descriptor = descriptors[key]
      if (!("value" in descriptor && descriptor.enumerable)) {
        return fail("not_plain_json")
      }
    }

    // Structural bytes AFTER guard/data-descriptor checks: "[" "]" once,
    // plus one comma BETWEEN elements (counted in the traversal below).
    const byteFail = addBytes(ctx, 2)
    if (byteFail) {
      return fail(byteFail)
    }

    for (let i = 0; i < value.length; i++) {
      const descriptor = descriptors[String(i)]
      if (!(descriptor && "value" in descriptor && descriptor.enumerable)) {
        return fail("not_plain_json")
      }
      if (i > 0) {
        const commaFail = addBytes(ctx, 1)
        if (commaFail) {
          return fail(commaFail)
        }
      }
      const result = preflightCandidate(descriptor.value, depth + 1, ctx)
      if (result) {
        return fail(result)
      }
    }

    ctx.seen.delete(value)
    return null
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype) {
    return fail("not_plain_json")
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return fail("not_plain_json")
  }
  if (Object.hasOwn(value, "toJSON")) {
    return fail("not_plain_json")
  }

  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Object.getOwnPropertyNames(descriptors)
  for (const key of keys) {
    const descriptor = descriptors[key]
    if (!("value" in descriptor && descriptor.enumerable)) {
      return fail("not_plain_json")
    }
  }

  // Structural bytes AFTER guard/data-descriptor checks: "{" "}", each
  // JSON-encoded key string with its ":", and one comma BETWEEN properties
  // only (none after the last key).
  const braceFail = addBytes(ctx, 2)
  if (braceFail) {
    return fail(braceFail)
  }
  for (let i = 0; i < keys.length; i++) {
    const keyOverhead = i + 1 < keys.length ? 2 : 1
    const keyFail = addBytes(ctx, encodedPrimitiveBytes(keys[i]) + keyOverhead)
    if (keyFail) {
      return fail(keyFail)
    }
  }

  for (const key of keys) {
    const result = preflightCandidate(descriptors[key].value, depth + 1, ctx)
    if (result) {
      return fail(result)
    }
  }

  ctx.seen.delete(value)
  return null
}

// Whitelisted source DTO containers. Only inspected fields are validated;
// ignored metadata (contentAttributes/attributes/sourceId/paths/...) is
// never walked, read, or serialized.
const SOURCE_REQUIRED_STRING_FIELDS = [
  "id",
  "createdAtMicros",
  "workspaceId",
  "conversationId",
  "senderType",
  "type",
] as const

const SOURCE_NULLABLE_STRING_FIELDS = ["text", "deletedAtMicros"] as const

const ATTACHMENT_REQUIRED_STRING_FIELDS = [
  "id",
  "fileType",
  "mimeType",
  "workspaceId",
  "conversationId",
  "messageId",
  "messageCreatedAtMicros",
] as const

const readDataDescriptor = (
  descriptors: PropertyDescriptorMap,
  key: string,
): { ok: true; value: unknown } | { ok: false } => {
  const descriptor = descriptors[key]
  if (!(descriptor && "value" in descriptor && descriptor.enumerable)) {
    return { ok: false }
  }
  return { ok: true, value: descriptor.value }
}

const checkRequiredStringField = (
  descriptors: PropertyDescriptorMap,
  key: string,
): ValidationFailCode | null => {
  const field = readDataDescriptor(descriptors, key)
  if (!field.ok || typeof field.value !== "string") {
    return "not_plain_json"
  }
  return preflightStringValue(field.value)
}

const checkNullableStringField = (
  descriptors: PropertyDescriptorMap,
  key: string,
): ValidationFailCode | null => {
  const field = readDataDescriptor(descriptors, key)
  if (!field.ok || (field.value !== null && typeof field.value !== "string")) {
    return "not_plain_json"
  }
  if (typeof field.value === "string") {
    return preflightStringValue(field.value)
  }
  return null
}

const preflightPlainContainer = (value: unknown): ValidationFailCode | null => {
  if (typeof value !== "object" || value === null) {
    return "not_plain_json"
  }
  if (types.isProxy(value)) {
    return "not_plain_json"
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype) {
    return "not_plain_json"
  }
  return null
}

// Dense, accessor-free, canonical-index array container. Proxy guard must
// already have run before Array.isArray / length / descriptor access.
const preflightDenseArray = (
  value: readonly unknown[],
): ValidationFailCode | null => {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return "not_plain_json"
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return "not_plain_json"
  }
  if (Object.hasOwn(value, "toJSON")) {
    return "not_plain_json"
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Object.getOwnPropertyNames(descriptors)) {
    if (key === "length") {
      continue
    }
    if (!ARRAY_INDEX_KEY.test(key) || Number(key) >= value.length) {
      return "not_plain_json"
    }
    const descriptor = descriptors[key]
    if (!("value" in descriptor && descriptor.enumerable)) {
      return "not_plain_json"
    }
  }
  for (let i = 0; i < value.length; i++) {
    const descriptor = descriptors[String(i)]
    if (!(descriptor && "value" in descriptor && descriptor.enumerable)) {
      return "not_plain_json"
    }
  }
  return null
}

const preflightSourceArray = (
  value: unknown,
  limits: ValidationLimits,
): ValidationFailCode | null => {
  // Proxy guard BEFORE Array.isArray: IsArray touches revoked-proxy traps.
  if (typeof value === "object" && value !== null && types.isProxy(value)) {
    return "not_plain_json"
  }
  if (!Array.isArray(value)) {
    return "not_plain_json"
  }
  // Scope the length cap before mass descriptor/iteration work.
  if (value.length > limits.maxSourceItems) {
    return "source_too_many_items"
  }
  return preflightDenseArray(value)
}

const preflightSourceAttachment = (
  value: unknown,
): ValidationFailCode | null => {
  const container = preflightPlainContainer(value)
  if (container) {
    return container
  }
  const descriptors = Object.getOwnPropertyDescriptors(value as object)
  for (const key of ATTACHMENT_REQUIRED_STRING_FIELDS) {
    const check = checkRequiredStringField(descriptors, key)
    if (check) {
      return check
    }
  }
  return checkNullableStringField(descriptors, "name")
}

const preflightSourceMessage = (
  value: unknown,
  limits: ValidationLimits,
): ValidationFailCode | null => {
  const container = preflightPlainContainer(value)
  if (container) {
    return container
  }
  const descriptors = Object.getOwnPropertyDescriptors(value as object)
  for (const key of SOURCE_REQUIRED_STRING_FIELDS) {
    const check = checkRequiredStringField(descriptors, key)
    if (check) {
      return check
    }
  }
  for (const key of SOURCE_NULLABLE_STRING_FIELDS) {
    const check = checkNullableStringField(descriptors, key)
    if (check) {
      return check
    }
  }

  const attachmentsField = readDataDescriptor(descriptors, "attachments")
  if (!attachmentsField.ok) {
    return "not_plain_json"
  }
  const attachments = attachmentsField.value
  // Proxy guard BEFORE Array.isArray on the attachment container.
  if (
    typeof attachments === "object" &&
    attachments !== null &&
    types.isProxy(attachments)
  ) {
    return "not_plain_json"
  }
  if (!Array.isArray(attachments)) {
    return "not_plain_json"
  }
  if (attachments.length > limits.maxAttachmentsPerMessage) {
    return "source_oversize"
  }
  return preflightDenseArray(attachments)
}

export const deriveAttribution = (
  dto: DialogMemoryMessageDto,
): AttributionKind => {
  switch (dto.senderType) {
    case "contact":
      return "contact"
    case "user":
      return "staff"
    case "bot":
    case "api":
      return "automation"
    default:
      return "unknown"
  }
}

const refKey = (ref: { id: string; createdAtMicros: string }): string =>
  `${ref.id}${NUL}${ref.createdAtMicros}`

// Enforces resolved (possibly smaller than hard) array/string caps after the
// strict schema parse. Never silently truncates or mutates the payload.
const enforceResolvedPayloadCaps = (
  payload: MemoryPayload,
  limits: ValidationLimits,
): ValidationFailCode | null => {
  if (payload.facts.length > limits.maxFacts) {
    return "schema_mismatch"
  }
  for (const fact of payload.facts) {
    if (fact.quotes.length > limits.maxQuotesPerFact) {
      return "schema_mismatch"
    }
    for (const quote of fact.quotes) {
      if (quote.text.length > limits.maxQuoteUtf16Chars) {
        return "schema_mismatch"
      }
    }
  }
  if (payload.narrative.text.length > limits.maxNarrativeUtf16Chars) {
    return "schema_mismatch"
  }
  if (payload.openQuestions.length > limits.maxOpenQuestions) {
    return "schema_mismatch"
  }
  for (const question of payload.openQuestions) {
    if (question.text.length > limits.maxOpenQuestionUtf16Chars) {
      return "schema_mismatch"
    }
  }
  return null
}

export const parseMemoryPayload = (
  candidate: unknown,
  options?: MemoryParseOptions,
):
  | { kind: "ok"; payload: MemoryPayload }
  | { kind: "reject"; reason: ValidationFailCode } => {
  const limits = resolveLimits(options?.limits)
  const nowMs = options?.nowMs ?? Date.now
  const deadlineAtMs = options?.deadlineAtMs
  const signal = options?.signal
  const checkClock = (): ValidationFailCode | null =>
    checkDeadlineSignal(deadlineAtMs, signal, nowMs)

  const initial = checkClock()
  if (initial) {
    return { kind: "reject", reason: initial }
  }

  let parsed: unknown
  if (typeof candidate === "string") {
    // Raw UTF-8 byte cap on the string candidate BEFORE JSON.parse.
    if (Buffer.byteLength(candidate, "utf8") > limits.maxCandidateUtf8Bytes) {
      return { kind: "reject", reason: "oversize" }
    }
    try {
      parsed = JSON.parse(candidate)
    } catch {
      return { kind: "reject", reason: "parse_failed" }
    }
  } else {
    parsed = candidate
  }

  const preflight = preflightCandidate(parsed, 1, {
    limits,
    seen: new WeakSet(),
    nodes: { count: 0 },
    bytes: { total: 0 },
    checkClock,
  })
  if (preflight) {
    return { kind: "reject", reason: preflight }
  }

  const afterPreflight = checkClock()
  if (afterPreflight) {
    return { kind: "reject", reason: afterPreflight }
  }

  let payload: MemoryPayload
  try {
    payload = memoryPayloadSchema.parse(parsed) as MemoryPayload
  } catch {
    return { kind: "reject", reason: "schema_mismatch" }
  }

  const caps = enforceResolvedPayloadCaps(payload, limits)
  if (caps) {
    return { kind: "reject", reason: caps }
  }

  const afterSchema = checkClock()
  if (afterSchema) {
    return { kind: "reject", reason: afterSchema }
  }

  return { kind: "ok", payload }
}

export const prepareMemorySources = (
  input: {
    sourceEvidence: readonly DialogMemoryMessageDto[]
    scope: DialogMemoryScope
    deadlineAtMs: number
    signal?: AbortSignal
  },
  options?: MemoryValidationOptions,
):
  | { kind: "ok"; sources: readonly PreparedMemorySource[] }
  | { kind: "reject"; reason: ValidationFailCode } => {
  const limits = resolveLimits(options?.limits)
  const nowMs = options?.nowMs ?? Date.now
  const { sourceEvidence, scope, deadlineAtMs, signal } = input
  const checkClock = (): ValidationFailCode | null =>
    checkDeadlineSignal(deadlineAtMs, signal, nowMs)

  const initial = checkClock()
  if (initial) {
    return { kind: "reject", reason: initial }
  }

  const arrayPreflight = preflightSourceArray(sourceEvidence as unknown, limits)
  if (arrayPreflight) {
    return { kind: "reject", reason: arrayPreflight }
  }

  if (sourceEvidence.length > limits.maxSourceItems) {
    return { kind: "reject", reason: "source_too_many_items" }
  }

  const afterCount = checkClock()
  if (afterCount) {
    return { kind: "reject", reason: afterCount }
  }

  const seenRefs = new Set<string>()
  const sources: PreparedMemorySource[] = []
  let projectedBytes = 0

  for (const dto of sourceEvidence) {
    const loopCheck = checkClock()
    if (loopCheck) {
      return { kind: "reject", reason: loopCheck }
    }

    const messagePreflight = preflightSourceMessage(dto as unknown, limits)
    if (messagePreflight) {
      return { kind: "reject", reason: messagePreflight }
    }

    const ref = { id: dto.id, createdAtMicros: dto.createdAtMicros }
    try {
      compareRefsAsc(ref, ref)
    } catch {
      return { kind: "reject", reason: "schema_mismatch" }
    }

    const fullRef = refKey(ref)
    if (seenRefs.has(fullRef)) {
      return { kind: "reject", reason: "ref_ambiguous" }
    }
    seenRefs.add(fullRef)

    if (
      dto.workspaceId !== scope.workspaceId ||
      dto.conversationId !== scope.conversationId
    ) {
      return { kind: "reject", reason: "scope_mismatch" }
    }

    const attribution = deriveAttribution(dto)
    const eligible = dto.type === "message" && dto.deletedAtMicros === null

    if (dto.attachments.length > limits.maxAttachmentsPerMessage) {
      return { kind: "reject", reason: "source_oversize" }
    }

    const attachments: MemoryAttachmentView[] = []
    for (const attachment of dto.attachments) {
      const attachmentClock = checkClock()
      if (attachmentClock) {
        return { kind: "reject", reason: attachmentClock }
      }

      const attachmentPreflight = preflightSourceAttachment(
        attachment as unknown,
      )
      if (attachmentPreflight) {
        return { kind: "reject", reason: attachmentPreflight }
      }

      if (
        attachment.workspaceId !== dto.workspaceId ||
        attachment.conversationId !== dto.conversationId ||
        attachment.messageId !== dto.id ||
        attachment.messageCreatedAtMicros !== dto.createdAtMicros
      ) {
        return { kind: "reject", reason: "scope_mismatch" }
      }

      attachments.push({
        id: attachment.id,
        fileType: attachment.fileType,
        mimeType: attachment.mimeType,
        name: attachment.name,
      })
    }

    const prepared: PreparedMemorySource = {
      attachments,
      ref,
      id: dto.id,
      createdAtMicros: dto.createdAtMicros,
      conversationId: dto.conversationId,
      workspaceId: dto.workspaceId,
      text: dto.text,
      type: dto.type,
      deletedAtMicros: dto.deletedAtMicros,
      attribution,
      eligible,
    }

    // Early projected-budget guard before serialization: UTF-16 length of the
    // largest field is a lower bound on the encoded UTF-8 size.
    if (
      prepared.text !== null &&
      projectedBytes + prepared.text.length > limits.maxSourceProjectedUtf8Bytes
    ) {
      return { kind: "reject", reason: "source_oversize" }
    }

    const projectedChunk = JSON.stringify({
      id: prepared.id,
      createdAtMicros: prepared.createdAtMicros,
      text: prepared.text,
      type: prepared.type,
      deletedAtMicros: prepared.deletedAtMicros,
      attribution: prepared.attribution,
      eligible: prepared.eligible,
      attachments: prepared.attachments,
    })
    projectedBytes += Buffer.byteLength(projectedChunk, "utf8")

    if (projectedBytes > limits.maxSourceProjectedUtf8Bytes) {
      return { kind: "reject", reason: "source_oversize" }
    }

    sources.push(prepared)
  }

  const finalCheck = checkClock()
  if (finalCheck) {
    return { kind: "reject", reason: finalCheck }
  }

  return { kind: "ok", sources }
}

export const validateMemoryPayload = (
  input: {
    candidatePayload: unknown
    sourceEvidence: readonly DialogMemoryMessageDto[]
    scope: DialogMemoryScope
    deadlineAtMs: number
    signal?: AbortSignal
  },
  options?: MemoryValidationOptions,
): ValidationOutcome => {
  const limits = resolveLimits(options?.limits)
  const nowMs = options?.nowMs ?? Date.now
  const { candidatePayload, sourceEvidence, scope, deadlineAtMs, signal } =
    input
  const checkClock = (): ValidationFailCode | null =>
    checkDeadlineSignal(deadlineAtMs, signal, nowMs)

  const parsed = parseMemoryPayload(candidatePayload, {
    limits,
    nowMs,
    deadlineAtMs,
    signal,
  })
  if (parsed.kind === "reject") {
    return parsed
  }

  const afterParse = checkClock()
  if (afterParse) {
    return { kind: "reject", reason: afterParse }
  }

  const prepared = prepareMemorySources(
    { sourceEvidence, scope, deadlineAtMs, signal },
    { limits, nowMs },
  )
  if (prepared.kind === "reject") {
    return prepared
  }

  const sourceMap = new Map<string, PreparedMemorySource>()
  for (const source of prepared.sources) {
    sourceMap.set(refKey(source.ref), source)
  }

  const afterPrepare = checkClock()
  if (afterPrepare) {
    return { kind: "reject", reason: afterPrepare }
  }

  for (const fact of parsed.payload.facts) {
    for (const quote of fact.quotes) {
      const loopCheck = checkClock()
      if (loopCheck) {
        return { kind: "reject", reason: loopCheck }
      }

      const source = sourceMap.get(refKey(quote.ref))
      if (!source) {
        return { kind: "reject", reason: "ref_not_found" }
      }
      if (!source.eligible) {
        return { kind: "reject", reason: "ref_ineligible" }
      }
      if (source.attribution !== fact.attribution) {
        return { kind: "reject", reason: "role_forged" }
      }
      if (source.text === null || !source.text.includes(quote.text)) {
        return { kind: "reject", reason: "quote_mismatch" }
      }
    }
  }

  const finalCheck = checkClock()
  if (finalCheck) {
    return { kind: "reject", reason: finalCheck }
  }

  return { kind: "accept", payload: parsed.payload }
}

export const createDialogMemoryValidator = (
  deps?: MemoryValidationOptions,
): SemanticValidatorPort => {
  const limits = resolveLimits(deps?.limits)
  const nowMs = deps?.nowMs ?? Date.now

  return {
    validate: async (input) =>
      validateMemoryPayload(
        {
          candidatePayload: input.candidatePayload,
          sourceEvidence: input.sourceEvidence,
          scope: input.scope,
          deadlineAtMs: input.deadlineAtMs,
          signal: input.signal,
        },
        { limits, nowMs },
      ) as
        | { kind: "accept"; payload: unknown }
        | { kind: "reject"; reason: string },
  }
}

export const checkPriorQuoteRetention = (
  input: {
    priorPayload: unknown | null
    candidatePayload: unknown
  },
  options?: MemoryParseOptions,
):
  | { kind: "ok" }
  | {
      kind: "reject"
      reason: ValidationFailCode | "prior_retention_violation"
    } => {
  const limits = resolveLimits(options?.limits)
  const nowMs = options?.nowMs ?? Date.now
  const deadlineAtMs = options?.deadlineAtMs
  const signal = options?.signal
  const checkClock = (): ValidationFailCode | null =>
    checkDeadlineSignal(deadlineAtMs, signal, nowMs)

  const candidateParse = parseMemoryPayload(input.candidatePayload, {
    limits,
    nowMs,
    deadlineAtMs,
    signal,
  })
  if (candidateParse.kind === "reject") {
    return candidateParse
  }

  if (input.priorPayload === null) {
    return { kind: "ok" }
  }

  const priorParse = parseMemoryPayload(input.priorPayload, {
    limits,
    nowMs,
    deadlineAtMs,
    signal,
  })
  if (priorParse.kind === "reject") {
    return priorParse
  }

  const afterParse = checkClock()
  if (afterParse) {
    return { kind: "reject", reason: afterParse }
  }

  const priorWitnesses = new Set<string>()
  for (const fact of priorParse.payload.facts) {
    for (const quote of fact.quotes) {
      const loopCheck = checkClock()
      if (loopCheck) {
        return { kind: "reject", reason: loopCheck }
      }
      priorWitnesses.add(
        `${fact.attribution}${NUL}${quote.ref.id}${NUL}${quote.ref.createdAtMicros}${NUL}${quote.text}`,
      )
    }
  }

  const newWitnesses = new Set<string>()
  for (const fact of candidateParse.payload.facts) {
    for (const quote of fact.quotes) {
      const loopCheck = checkClock()
      if (loopCheck) {
        return { kind: "reject", reason: loopCheck }
      }
      newWitnesses.add(
        `${fact.attribution}${NUL}${quote.ref.id}${NUL}${quote.ref.createdAtMicros}${NUL}${quote.text}`,
      )
    }
  }

  for (const witness of priorWitnesses) {
    const loopCheck = checkClock()
    if (loopCheck) {
      return { kind: "reject", reason: loopCheck }
    }
    if (!newWitnesses.has(witness)) {
      return { kind: "reject", reason: "prior_retention_violation" }
    }
  }

  return { kind: "ok" }
}
