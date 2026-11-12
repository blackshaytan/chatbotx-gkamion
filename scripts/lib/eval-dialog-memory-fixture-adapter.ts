import type {
  DialogMemoryMessageDto,
  DialogMemoryScope,
} from "@chatbotx.io/database/repositories"
import { z } from "zod"
import type {
  AttributionKind,
  MemoryValidationOptions,
  PayloadSourceRef,
  ValidationFailCode,
} from "../../packages/business/src/external-agent/memory-contract"
import { compareRefsAsc } from "../../packages/business/src/external-agent/memory-coverage"
import {
  deriveAttribution,
  prepareMemorySources,
} from "../../packages/business/src/external-agent/memory-validation"

export const ADAPTER_VERSION = "t08-fixture-v1" as const
export const MAX_CASE_JSON_UTF8_BYTES = 2_097_152 as const

export type AdaptFailCode =
  | "invalid_case_json"
  | "case_too_large"
  | "fixture_schema_mismatch"
  | "duplicate_fixture_id"
  | "invalid_time"
  | "time_precision_loss"
  | "invalid_current_window"
  | "invalid_expected_evidence"
  | "source_rejected"
  | "deadline"
  | "cancelled"

export type AdaptedSource = {
  scope: DialogMemoryScope
  eligibleHistory: readonly DialogMemoryMessageDto[]
  evidenceSnapshot: readonly DialogMemoryMessageDto[]
}

export type SourceMetadata = {
  fixtureMessageId: string
  role: "contact" | "manager" | "platform" | "assistant"
  channel: string
  orderId: string | null
}

export type ExpectedWitness = {
  fixtureMessageId: string
  ref: PayloadSourceRef
  quote: string
  attribution: AttributionKind
  kind:
    | "client_claim"
    | "manager_statement"
    | "platform_notice"
    | "assistant_statement"
  orderId: string | null
}

export type PrivateGradingEnvelope = {
  caseId: string
  split: "development" | "holdout"
  scenario: string
  currentWindowRefs: readonly PayloadSourceRef[]
  fixtureToDtoId: ReadonlyMap<string, string>
  dtoToFixtureId: ReadonlyMap<string, string>
  requiredEvidence: readonly ExpectedWitness[]
  openQuestions: readonly string[]
  forbiddenClaims: readonly string[]
  expectedBehavior: string
  sourceMetadataByDtoId: ReadonlyMap<string, SourceMetadata>
}

const ROLE_TO_SENDER_TYPE: Record<
  "contact" | "manager" | "platform" | "assistant",
  string
> = {
  contact: "contact",
  manager: "user",
  platform: "api",
  assistant: "bot",
}

const FIXTURE_TIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/

export const normalizeFixtureTime = (
  value: unknown,
):
  | { kind: "ok"; value: string }
  | { kind: "reject"; reason: "invalid_time" | "time_precision_loss" } => {
  if (typeof value !== "string") {
    return { kind: "reject", reason: "invalid_time" }
  }

  const match = FIXTURE_TIME_RE.exec(value)
  if (!match) {
    return { kind: "reject", reason: "invalid_time" }
  }

  const rawFraction = match[2] ?? ""
  if (rawFraction.length > 6) {
    // Well-formed UTC with sub-microsecond precision: recognized before any
    // calendar check and rejected without rounding or slicing the digits.
    return { kind: "reject", reason: "time_precision_loss" }
  }

  const fraction = rawFraction.padEnd(6, "0")
  const canonical = `${match[1]}.${fraction}Z`

  try {
    compareRefsAsc(
      { id: "1", createdAtMicros: canonical },
      { id: "1", createdAtMicros: canonical },
    )
  } catch {
    return { kind: "reject", reason: "invalid_time" }
  }

  return { kind: "ok", value: canonical }
}

const fixtureMessageSchema = z.strictObject({
  id: z.string().min(1),
  createdAt: z.string(),
  role: z.enum(["contact", "manager", "platform", "assistant"]),
  channel: z.string().min(1),
  text: z.string(),
  orderId: z.string().nullable(),
  deleted: z.boolean().optional(),
  deletedAt: z.string().nullable().optional(),
})

const fixtureEvidenceSchema = z.strictObject({
  messageId: z.string().min(1),
  quote: z.string().min(1),
  kind: z.enum([
    "client_claim",
    "manager_statement",
    "platform_notice",
    "assistant_statement",
  ]),
  orderId: z.string().nullable(),
})

const fixtureCaseSchema = z.strictObject({
  id: z.string().regex(/^t06-c[0-9]{2}$/),
  split: z.enum(["development", "holdout"]),
  scenario: z.string().min(1),
  messages: z.array(fixtureMessageSchema),
  currentMessageIds: z.array(z.string().min(1)),
  requiredEvidence: z.array(fixtureEvidenceSchema),
  openQuestions: z.array(z.string()),
  forbiddenClaims: z.array(z.string()),
  expectedBehavior: z.string().min(1),
  mutation: z.object({}).passthrough().optional(),
})

type FixtureCase = z.infer<typeof fixtureCaseSchema>

type ClockResult = "deadline" | "cancelled" | null

const checkClock = (
  deadlineAtMs: number,
  signal: AbortSignal | undefined,
  nowMs: () => number,
): ClockResult => {
  if (signal?.aborted) {
    return "cancelled"
  }
  if (nowMs() >= deadlineAtMs) {
    return "deadline"
  }
  return null
}

type OrdinalMapResult =
  | { kind: "ok"; map: Map<string, string> }
  | { kind: "reject"; reason: Exclude<ClockResult, null> }

// Constructive bijection: sorted opaque keys get BigInt ordinals from 1n.
// The tick runs before each write, so cancellation/deadline stop the loop
// instead of finishing all Map writes first.
const buildOrdinalMap = (
  keys: readonly string[],
  tick: () => ClockResult,
): OrdinalMapResult => {
  const sorted = [...keys].sort()
  const map = new Map<string, string>()
  let ordinal = 1n
  for (const key of sorted) {
    const clock = tick()
    if (clock) {
      return { kind: "reject", reason: clock }
    }
    map.set(key, ordinal.toString())
    ordinal += 1n
  }
  return { kind: "ok", map }
}

const makeReject = (
  reason: AdaptFailCode,
  sourceReason?: ValidationFailCode,
): {
  kind: "reject"
  reason: AdaptFailCode
  sourceReason?: ValidationFailCode
} =>
  sourceReason === undefined
    ? { kind: "reject", reason }
    : { kind: "reject", reason, sourceReason }

export const adaptDialogMemoryCase = (
  input: {
    caseJson: unknown
    scope: DialogMemoryScope
    deadlineAtMs: number
    signal?: AbortSignal
  },
  options?: MemoryValidationOptions,
):
  | { kind: "ok"; source: AdaptedSource; grading: PrivateGradingEnvelope }
  | {
      kind: "reject"
      reason: AdaptFailCode
      sourceReason?: ValidationFailCode
    } => {
  const { caseJson, scope, deadlineAtMs, signal } = input
  const nowMs = options?.nowMs ?? Date.now
  const tick = (): ClockResult => checkClock(deadlineAtMs, signal, nowMs)

  let clock = tick()
  if (clock) {
    return makeReject(clock)
  }

  if (typeof caseJson !== "string") {
    return makeReject("invalid_case_json")
  }

  if (Buffer.byteLength(caseJson, "utf8") > MAX_CASE_JSON_UTF8_BYTES) {
    return makeReject("case_too_large")
  }

  clock = tick()
  if (clock) {
    return makeReject(clock)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(caseJson)
  } catch {
    return makeReject("invalid_case_json")
  }

  clock = tick()
  if (clock) {
    return makeReject(clock)
  }

  let fixtureCase: FixtureCase
  try {
    fixtureCase = fixtureCaseSchema.parse(parsed)
  } catch {
    return makeReject("fixture_schema_mismatch")
  }

  clock = tick()
  if (clock) {
    return makeReject(clock)
  }

  const seenFixtureIds = new Set<string>()
  for (const message of fixtureCase.messages) {
    clock = tick()
    if (clock) {
      return makeReject(clock)
    }

    if (seenFixtureIds.has(message.id)) {
      return makeReject("duplicate_fixture_id")
    }
    seenFixtureIds.add(message.id)
  }

  const fixtureIdMap = buildOrdinalMap(
    fixtureCase.messages.map((m) => m.id),
    tick,
  )
  if (fixtureIdMap.kind === "reject") {
    return makeReject(fixtureIdMap.reason)
  }
  const fixtureToDtoId = fixtureIdMap.map

  const dtoToFixtureId = new Map<string, string>()
  for (const [fixtureId, dtoId] of fixtureToDtoId) {
    clock = tick()
    if (clock) {
      return makeReject(clock)
    }
    dtoToFixtureId.set(dtoId, fixtureId)
  }

  clock = tick()
  if (clock) {
    return makeReject(clock)
  }

  const distinctChannels = Array.from(
    new Set(fixtureCase.messages.map((m) => m.channel)),
  )
  const channelMap = buildOrdinalMap(distinctChannels, tick)
  if (channelMap.kind === "reject") {
    return makeReject(channelMap.reason)
  }
  const channelToOrdinal = channelMap.map

  const dtos: DialogMemoryMessageDto[] = []
  const sourceMetadataByDtoId = new Map<string, SourceMetadata>()

  for (const message of fixtureCase.messages) {
    clock = tick()
    if (clock) {
      return makeReject(clock)
    }

    const dtoId = fixtureToDtoId.get(message.id)
    if (dtoId === undefined) {
      return makeReject("fixture_schema_mismatch")
    }
    const contactInboxId = channelToOrdinal.get(message.channel)
    if (contactInboxId === undefined) {
      return makeReject("fixture_schema_mismatch")
    }

    const createdResult = normalizeFixtureTime(message.createdAt)
    if (createdResult.kind === "reject") {
      return makeReject(createdResult.reason)
    }
    const createdAtMicros = createdResult.value

    const isDeleted = message.deleted === true
    let deletedAtMicros: string | null = null
    if (isDeleted) {
      if (message.deletedAt === undefined || message.deletedAt === null) {
        return makeReject("fixture_schema_mismatch")
      }
      const deletedResult = normalizeFixtureTime(message.deletedAt)
      if (deletedResult.kind === "reject") {
        return makeReject(deletedResult.reason)
      }
      deletedAtMicros = deletedResult.value
    } else if (message.deletedAt !== undefined && message.deletedAt !== null) {
      return makeReject("fixture_schema_mismatch")
    }

    const dto: DialogMemoryMessageDto = {
      id: dtoId,
      createdAtMicros,
      updatedAtMicros: createdAtMicros,
      conversationId: scope.conversationId,
      contactInboxId,
      workspaceId: scope.workspaceId,
      text: message.text,
      contentAttributes: null,
      messageType: message.role === "contact" ? "incoming" : "outgoing",
      contentType: "text",
      senderType: ROLE_TO_SENDER_TYPE[message.role],
      senderId: null,
      sourceId: null,
      deletedAtMicros,
      type: "message",
      parentId: null,
      attributes: null,
      sendError: null,
      attachments: [],
    }

    dtos.push(dto)
    sourceMetadataByDtoId.set(dtoId, {
      fixtureMessageId: message.id,
      role: message.role,
      channel: message.channel,
      orderId: message.orderId,
    })
  }

  clock = tick()
  if (clock) {
    return makeReject(clock)
  }
  const evidenceSnapshot = [...dtos].sort((a, b) =>
    compareRefsAsc(
      { id: a.id, createdAtMicros: a.createdAtMicros },
      { id: b.id, createdAtMicros: b.createdAtMicros },
    ),
  )

  clock = tick()
  if (clock) {
    return makeReject(clock)
  }
  const eligibleHistory = evidenceSnapshot.filter(
    (dto) => dto.type === "message" && dto.deletedAtMicros === null,
  )

  const dtoById = new Map<string, DialogMemoryMessageDto>()
  for (const dto of dtos) {
    clock = tick()
    if (clock) {
      return makeReject(clock)
    }
    dtoById.set(dto.id, dto)
  }

  const currentMessageIdsSeen = new Set<string>()
  const currentWindowRefs: PayloadSourceRef[] = []
  for (const fixtureId of fixtureCase.currentMessageIds) {
    clock = tick()
    if (clock) {
      return makeReject(clock)
    }

    if (currentMessageIdsSeen.has(fixtureId)) {
      return makeReject("invalid_current_window")
    }
    currentMessageIdsSeen.add(fixtureId)

    const dtoId = fixtureToDtoId.get(fixtureId)
    if (dtoId === undefined) {
      return makeReject("invalid_current_window")
    }
    const dto = dtoById.get(dtoId)
    if (
      dto === undefined ||
      dto.deletedAtMicros !== null ||
      dto.type !== "message"
    ) {
      return makeReject("invalid_current_window")
    }
    currentWindowRefs.push({ id: dtoId, createdAtMicros: dto.createdAtMicros })
  }

  const requiredEvidence: ExpectedWitness[] = []
  for (const evidence of fixtureCase.requiredEvidence) {
    clock = tick()
    if (clock) {
      return makeReject(clock)
    }

    const dtoId = fixtureToDtoId.get(evidence.messageId)
    if (dtoId === undefined) {
      return makeReject("invalid_expected_evidence")
    }
    const dto = dtoById.get(dtoId)
    if (
      dto === undefined ||
      dto.deletedAtMicros !== null ||
      dto.type !== "message"
    ) {
      return makeReject("invalid_expected_evidence")
    }
    if (dto.text === null || !dto.text.includes(evidence.quote)) {
      return makeReject("invalid_expected_evidence")
    }
    requiredEvidence.push({
      fixtureMessageId: evidence.messageId,
      ref: { id: dtoId, createdAtMicros: dto.createdAtMicros },
      quote: evidence.quote,
      attribution: deriveAttribution(dto),
      kind: evidence.kind,
      orderId: evidence.orderId,
    })
  }

  const prepared = prepareMemorySources(
    {
      sourceEvidence: evidenceSnapshot,
      scope: { ...scope },
      deadlineAtMs,
      signal,
    },
    { ...options, nowMs },
  )
  if (prepared.kind === "reject") {
    if (prepared.reason === "deadline" || prepared.reason === "cancelled") {
      return makeReject(prepared.reason)
    }
    return makeReject("source_rejected", prepared.reason)
  }

  clock = tick()
  if (clock) {
    return makeReject(clock)
  }

  const grading: PrivateGradingEnvelope = {
    caseId: fixtureCase.id,
    split: fixtureCase.split,
    scenario: fixtureCase.scenario,
    currentWindowRefs,
    fixtureToDtoId,
    dtoToFixtureId,
    requiredEvidence,
    openQuestions: fixtureCase.openQuestions,
    forbiddenClaims: fixtureCase.forbiddenClaims,
    expectedBehavior: fixtureCase.expectedBehavior,
    sourceMetadataByDtoId,
  }

  const source: AdaptedSource = {
    scope: { ...scope },
    eligibleHistory,
    evidenceSnapshot,
  }

  return { kind: "ok", source, grading }
}
