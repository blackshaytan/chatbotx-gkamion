import { types } from "node:util"
import type {
  DialogMemoryMessageDto,
  DialogMemoryScope,
} from "@chatbotx.io/database/repositories"
import {
  type MemoryValidationOptions,
  type PreparedMemorySource,
  type PromptMessage,
  VALIDATION_LIMITS,
  type ValidationFailCode,
  type ValidationLimitsOverride,
} from "../../packages/business/src/external-agent/memory-contract"
import {
  checkPriorQuoteRetention,
  parseMemoryPayload,
  prepareMemorySources,
  validateMemoryPayload,
} from "../../packages/business/src/external-agent/memory-validation"
import type {
  AdaptedSource,
  PrivateGradingEnvelope,
} from "./eval-dialog-memory-fixture-adapter"
import {
  buildJudgeRequest,
  type JudgeBudget,
  type JudgeDecision,
  parseJudgeResponse,
} from "./eval-dialog-memory-judge"

export const EVALUATOR_VERSION = "t08-evaluator-v1" as const
export const MAX_RAW_CANDIDATE_UTF16_CHARS = 20_000 as const
export const MAX_RAW_CANDIDATE_UTF8_BYTES = 65_536 as const
export const MAX_WITNESSES_PER_CASE = 1024 as const

export type EvalOutcome =
  | "pass"
  | "reject"
  | "inconclusive"
  | "budget_blocked"
  | "transport_error"
  | "invalid_output"
  | "not_tested"
  | "gate_pending"
  | "not_exercised"

export type CaseDisposition = "eligible" | "not_exercised" | "gate_pending"

export type EvalFailCode =
  | "invalid_input"
  | "candidate_not_a_string"
  | "candidate_output_oversize"
  | "candidate_invalid_output"
  | "candidate_source_invalid"
  | "source_budget_exceeded"
  | "invalid_prior"
  | "prior_retention_violation"
  | "invalid_mode_config"
  | "invalid_grading"
  | "required_evidence_missing"
  | "witness_unrepresentable"
  | "judge_packet_oversize"
  | "judge_response_invalid"
  | "judge_response_oversize"
  | "deadline"
  | "cancelled"
  | "transport_error"

export type EvalPhase =
  | "guard"
  | "parse"
  | "source"
  | "prior"
  | "witness"
  | "judgeBuild"
  | "judgeCall"
  | "judgeParse"

export type JudgePortCall = {
  readonly messages: readonly PromptMessage[]
  readonly deadlineAtMs: number
  readonly signal?: AbortSignal
}

export type JudgePortResult =
  | { readonly kind: "ok"; readonly content: string }
  | {
      readonly kind: "unavailable"
      readonly reason:
        | "deadline"
        | "cancelled"
        | "transport_error"
        | "invalid_output"
    }

export type JudgePort = (call: JudgePortCall) => Promise<JudgePortResult>

export type EvaluatorCoverage = {
  required: number
  covered: number
}

export type EvaluateDialogMemoryCaseInput = {
  source: AdaptedSource
  candidateRaw: unknown
  grade: PrivateGradingEnvelope
  mode: "rebuild" | "append"
  priorPayload: unknown | null
  caseDisposition: CaseDisposition
  deadlineAtMs: number
  signal?: AbortSignal
  judgePort: JudgePort
}

export type EvaluatorOptions = {
  nowMs?: () => number
  limits?: ValidationLimitsOverride
  maxWitnesses?: number
  judgeBudget?: JudgeBudget
}

export type EvaluateDialogMemoryCaseResult = {
  caseId: string
  outcome: EvalOutcome
  codes: readonly EvalFailCode[]
  coverage: EvaluatorCoverage
  judge?: JudgeDecision
  diagnostics?: {
    phase: EvalPhase
    witnessIndex?: number
    t07Reason?: ValidationFailCode
  }
}

const NUL = String.fromCharCode(0)

type DataField =
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }

// Distinguishes a genuinely absent key from a present-but-unusable
// descriptor (accessor or non-enumerable). Getters are never invoked.
const readDataField = (container: object, key: string): DataField => {
  const descriptor = Object.getOwnPropertyDescriptor(container, key)
  if (descriptor === undefined) {
    return { kind: "absent" }
  }
  if (!("value" in descriptor && descriptor.enumerable)) {
    return { kind: "invalid" }
  }
  return { kind: "ok", value: descriptor.value }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || types.isProxy(value)) {
    return false
  }
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
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

const validateConfig = (options: EvaluatorOptions | undefined) => {
  const nowMs = options?.nowMs ?? Date.now
  const shared: MemoryValidationOptions = {
    limits: options?.limits,
    nowMs,
  }

  let effectiveMaxWitnesses: number = MAX_WITNESSES_PER_CASE
  if (options?.maxWitnesses !== undefined) {
    if (
      !Number.isSafeInteger(options.maxWitnesses) ||
      options.maxWitnesses <= 0 ||
      options.maxWitnesses > MAX_WITNESSES_PER_CASE
    ) {
      throw new RangeError("Invalid maxWitnesses")
    }
    effectiveMaxWitnesses = options.maxWitnesses
  }

  return {
    nowMs,
    shared,
    effectiveMaxWitnesses,
    judgeBudget: options?.judgeBudget,
  }
}

const makeResult = (
  caseId: string,
  outcome: EvalOutcome,
  codes: readonly EvalFailCode[],
  required: number,
  covered: number,
  diagnostics?: {
    phase: EvalPhase
    witnessIndex?: number
    t07Reason?: ValidationFailCode
  },
  judge?: JudgeDecision,
): EvaluateDialogMemoryCaseResult => ({
  caseId,
  outcome,
  codes,
  coverage: { required, covered },
  ...(diagnostics && { diagnostics }),
  ...(judge && { judge }),
})

const mapNonClockValidationFailure = (
  reason: ValidationFailCode,
  oversizeCode: EvalFailCode,
  otherCode: EvalFailCode,
  phase: EvalPhase,
  caseId: string,
  required: number,
  covered: number,
): EvaluateDialogMemoryCaseResult =>
  makeResult(
    caseId,
    "invalid_output",
    [reason === "oversize" ? oversizeCode : otherCode],
    required,
    covered,
    { phase, t07Reason: reason },
  )

export const evaluateDialogMemoryCase = async (
  input: EvaluateDialogMemoryCaseInput,
  options?: EvaluatorOptions,
): Promise<EvaluateDialogMemoryCaseResult> => {
  // ---- 0. minimal root guard + disposition, before any config validation ----
  if (!isPlainObject(input)) {
    return makeResult("unknown", "gate_pending", ["invalid_input"], 0, 0, {
      phase: "guard",
    })
  }

  const gradeField = readDataField(input, "grade")
  if (gradeField.kind !== "ok" || !isPlainObject(gradeField.value)) {
    return makeResult("unknown", "gate_pending", ["invalid_input"], 0, 0, {
      phase: "guard",
    })
  }
  const grade = gradeField.value

  const caseIdField = readDataField(grade, "caseId")
  const caseId =
    caseIdField.kind === "ok" && typeof caseIdField.value === "string"
      ? caseIdField.value
      : "unknown"

  const dispositionField = readDataField(input, "caseDisposition")
  const disposition =
    dispositionField.kind === "ok" ? dispositionField.value : undefined
  if (disposition === "not_exercised") {
    return makeResult(caseId, "not_exercised", [], 0, 0)
  }
  if (disposition !== "eligible") {
    return makeResult(caseId, "gate_pending", [], 0, 0, { phase: "guard" })
  }

  // ---- server configuration is validated only for exercised cases ----
  const { nowMs, shared, effectiveMaxWitnesses, judgeBudget } =
    validateConfig(options)

  // ---- full root guard ----
  const sourceField = readDataField(input, "source")
  const deadlineField = readDataField(input, "deadlineAtMs")
  const signalField = readDataField(input, "signal")
  const judgePortField = readDataField(input, "judgePort")

  if (
    sourceField.kind !== "ok" ||
    !isPlainObject(sourceField.value) ||
    deadlineField.kind !== "ok" ||
    typeof deadlineField.value !== "number" ||
    !Number.isSafeInteger(deadlineField.value) ||
    signalField.kind === "invalid" ||
    judgePortField.kind !== "ok" ||
    typeof judgePortField.value !== "function"
  ) {
    return makeResult(caseId, "gate_pending", ["invalid_input"], 0, 0, {
      phase: "guard",
    })
  }

  const signal = signalField.kind === "ok" ? signalField.value : undefined
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    return makeResult(caseId, "gate_pending", ["invalid_input"], 0, 0, {
      phase: "guard",
    })
  }

  const deadlineAtMs = deadlineField.value
  const checkClock = (): "deadline" | "cancelled" | null => {
    if (signal?.aborted) {
      return "cancelled"
    }
    if (nowMs() >= deadlineAtMs) {
      return "deadline"
    }
    return null
  }

  const source = sourceField.value as AdaptedSource
  const judgePort = judgePortField.value as JudgePort

  const clockStopAtStart = checkClock()
  if (clockStopAtStart) {
    return makeResult(caseId, "not_tested", [clockStopAtStart], 0, 0, {
      phase: "guard",
    })
  }

  // ---- 1. mode/prior guard ----
  const modeField = readDataField(input, "mode")
  const priorPayloadField = readDataField(input, "priorPayload")
  if (modeField.kind === "invalid" || priorPayloadField.kind === "invalid") {
    return makeResult(caseId, "gate_pending", ["invalid_input"], 0, 0, {
      phase: "guard",
    })
  }
  const mode = modeField.kind === "ok" ? modeField.value : undefined
  const priorPayload =
    priorPayloadField.kind === "ok" ? priorPayloadField.value : undefined
  if (mode !== "rebuild" && mode !== "append") {
    return makeResult(caseId, "gate_pending", ["invalid_mode_config"], 0, 0, {
      phase: "guard",
    })
  }
  if (mode === "rebuild" && priorPayload !== null) {
    return makeResult(caseId, "gate_pending", ["invalid_mode_config"], 0, 0, {
      phase: "guard",
    })
  }
  if (
    mode === "append" &&
    (priorPayload === null || priorPayload === undefined)
  ) {
    return makeResult(caseId, "gate_pending", ["invalid_mode_config"], 0, 0, {
      phase: "guard",
    })
  }

  // ---- source shape access (no reading of unused fields) ----
  const evidenceSnapshotField = readDataField(source, "evidenceSnapshot")
  const scopeField = readDataField(source, "scope")
  if (
    evidenceSnapshotField.kind !== "ok" ||
    scopeField.kind !== "ok" ||
    !isPlainObject(scopeField.value)
  ) {
    return makeResult(caseId, "gate_pending", ["invalid_input"], 0, 0, {
      phase: "guard",
    })
  }
  const evidenceSnapshot =
    evidenceSnapshotField.value as readonly DialogMemoryMessageDto[]
  const scope = scopeField.value as DialogMemoryScope

  const parseOptions = {
    ...shared,
    deadlineAtMs,
    signal,
  }

  // ---- 2/3. candidate raw guards and parse ----
  // Absent or accessor candidateRaw is root INPUT configuration, not
  // candidate content: gate_pending/invalid_input, getter never invoked.
  // Only an own data property reaches the candidate checks below.
  const candidateRawField = readDataField(input, "candidateRaw")
  if (candidateRawField.kind !== "ok") {
    return makeResult(caseId, "gate_pending", ["invalid_input"], 0, 0, {
      phase: "guard",
    })
  }
  const candidateRaw = candidateRawField.value
  if (typeof candidateRaw !== "string") {
    return makeResult(
      caseId,
      "invalid_output",
      ["candidate_not_a_string"],
      0,
      0,
      { phase: "parse" },
    )
  }
  if (
    candidateRaw.length > MAX_RAW_CANDIDATE_UTF16_CHARS ||
    Buffer.byteLength(candidateRaw, "utf8") > MAX_RAW_CANDIDATE_UTF8_BYTES
  ) {
    return makeResult(
      caseId,
      "invalid_output",
      ["candidate_output_oversize"],
      0,
      0,
      { phase: "parse" },
    )
  }

  const candidateParse = parseMemoryPayload(candidateRaw, parseOptions)
  if (candidateParse.kind === "reject") {
    if (
      candidateParse.reason === "deadline" ||
      candidateParse.reason === "cancelled"
    ) {
      return makeResult(caseId, "not_tested", [candidateParse.reason], 0, 0, {
        phase: "parse",
        t07Reason: candidateParse.reason,
      })
    }
    return mapNonClockValidationFailure(
      candidateParse.reason,
      "candidate_output_oversize",
      "candidate_invalid_output",
      "parse",
      caseId,
      0,
      0,
    )
  }

  // ---- 4. source preflight (whole evidence snapshot) ----
  const preparedSourcesResult = prepareMemorySources(
    { sourceEvidence: evidenceSnapshot, scope, deadlineAtMs, signal },
    shared,
  )
  if (preparedSourcesResult.kind === "reject") {
    const reason = preparedSourcesResult.reason
    if (reason === "deadline" || reason === "cancelled") {
      return makeResult(caseId, "not_tested", [reason], 0, 0, {
        phase: "source",
        t07Reason: reason,
      })
    }
    if (reason === "source_too_many_items" || reason === "source_oversize") {
      return makeResult(
        caseId,
        "budget_blocked",
        ["source_budget_exceeded"],
        0,
        0,
        {
          phase: "source",
          t07Reason: reason,
        },
      )
    }
    return makeResult(
      caseId,
      "gate_pending",
      ["candidate_source_invalid"],
      0,
      0,
      {
        phase: "source",
        t07Reason: reason,
      },
    )
  }
  const preparedSources = preparedSourcesResult.sources

  // ---- 5. validate the already parsed candidate against same full source ----
  const candidateValidation = validateMemoryPayload(
    {
      candidatePayload: candidateParse.payload,
      sourceEvidence: evidenceSnapshot,
      scope,
      deadlineAtMs,
      signal,
    },
    shared,
  )
  if (candidateValidation.kind === "reject") {
    const reason = candidateValidation.reason
    if (reason === "deadline" || reason === "cancelled") {
      return makeResult(caseId, "not_tested", [reason], 0, 0, {
        phase: "source",
        t07Reason: reason,
      })
    }
    return makeResult(
      caseId,
      "invalid_output",
      ["candidate_invalid_output"],
      0,
      0,
      { phase: "source", t07Reason: reason },
    )
  }
  const candidatePayload = candidateValidation.payload

  // ---- 6. prior validation and retention (append only) ----
  if (mode === "append") {
    const priorValidation = validateMemoryPayload(
      {
        candidatePayload: priorPayload,
        sourceEvidence: evidenceSnapshot,
        scope,
        deadlineAtMs,
        signal,
      },
      shared,
    )
    if (priorValidation.kind === "reject") {
      const reason = priorValidation.reason
      if (reason === "deadline" || reason === "cancelled") {
        return makeResult(caseId, "not_tested", [reason], 0, 0, {
          phase: "prior",
          t07Reason: reason,
        })
      }
      return makeResult(caseId, "gate_pending", ["invalid_prior"], 0, 0, {
        phase: "prior",
        t07Reason: reason,
      })
    }

    const retention = checkPriorQuoteRetention(
      {
        priorPayload: priorValidation.payload,
        candidatePayload,
      },
      parseOptions,
    )
    if (retention.kind === "reject") {
      const reason = retention.reason
      if (reason === "deadline" || reason === "cancelled") {
        return makeResult(caseId, "not_tested", [reason], 0, 0, {
          phase: "prior",
          t07Reason: reason,
        })
      }
      if (reason === "prior_retention_violation") {
        return makeResult(
          caseId,
          "reject",
          ["prior_retention_violation"],
          0,
          0,
          {
            phase: "prior",
          },
        )
      }
      return makeResult(caseId, "gate_pending", ["invalid_prior"], 0, 0, {
        phase: "prior",
        t07Reason: reason,
      })
    }
  }

  // ---- 7/8. validate grading and witnesses ----
  const requiredEvidenceField = readDataField(grade, "requiredEvidence")
  const fixtureToDtoIdField = readDataField(grade, "fixtureToDtoId")
  const dtoToFixtureIdField = readDataField(grade, "dtoToFixtureId")

  if (
    requiredEvidenceField.kind !== "ok" ||
    fixtureToDtoIdField.kind !== "ok" ||
    dtoToFixtureIdField.kind !== "ok"
  ) {
    return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
      phase: "witness",
    })
  }

  const requiredEvidenceValue = requiredEvidenceField.value
  const fixtureToDtoIdValue = fixtureToDtoIdField.value
  const dtoToFixtureIdValue = dtoToFixtureIdField.value

  // Proxy checks come before any reflection (Array.isArray/instanceof/size)
  // so revoked or trapped containers cannot throw inside the guard.
  if (
    types.isProxy(requiredEvidenceValue) ||
    types.isProxy(fixtureToDtoIdValue) ||
    types.isProxy(dtoToFixtureIdValue)
  ) {
    return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
      phase: "witness",
    })
  }

  if (
    !(
      Array.isArray(requiredEvidenceValue) &&
      fixtureToDtoIdValue instanceof Map &&
      dtoToFixtureIdValue instanceof Map
    )
  ) {
    return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
      phase: "witness",
    })
  }

  const fixtureToDtoId = fixtureToDtoIdValue as ReadonlyMap<string, string>
  const dtoToFixtureId = dtoToFixtureIdValue as ReadonlyMap<string, string>
  const requiredEvidence = requiredEvidenceValue as readonly unknown[]

  if (
    requiredEvidence.length > effectiveMaxWitnesses ||
    fixtureToDtoId.size !== dtoToFixtureId.size ||
    fixtureToDtoId.size !== preparedSources.length
  ) {
    return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
      phase: "witness",
    })
  }

  const sourceById = new Map<string, PreparedMemorySource>()
  for (const s of preparedSources) {
    const clock = checkClock()
    if (clock) {
      return makeResult(caseId, "not_tested", [clock], 0, 0, {
        phase: "witness",
      })
    }
    sourceById.set(s.id, s)
  }

  const coveredDtoIds = new Set<string>()
  for (const [fixtureId, dtoId] of fixtureToDtoId.entries()) {
    const clock = checkClock()
    if (clock) {
      return makeResult(caseId, "not_tested", [clock], 0, 0, {
        phase: "witness",
      })
    }
    if (
      typeof fixtureId !== "string" ||
      fixtureId.length === 0 ||
      typeof dtoId !== "string" ||
      dtoId.length === 0
    ) {
      return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
        phase: "witness",
      })
    }
    if (dtoToFixtureId.get(dtoId) !== fixtureId) {
      return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
        phase: "witness",
      })
    }
    coveredDtoIds.add(dtoId)
  }
  for (const s of preparedSources) {
    const clock = checkClock()
    if (clock) {
      return makeResult(caseId, "not_tested", [clock], 0, 0, {
        phase: "witness",
      })
    }
    if (!coveredDtoIds.has(s.id)) {
      return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
        phase: "witness",
      })
    }
  }

  const effectiveMaxQuoteChars =
    options?.limits?.maxQuoteUtf16Chars ?? VALIDATION_LIMITS.maxQuoteUtf16Chars

  type NormalizedWitness = {
    fixtureMessageId: string
    ref: { id: string; createdAtMicros: string }
    quote: string
    attribution: string
  }
  const normalizedWitnesses: NormalizedWitness[] = []

  for (let i = 0; i < requiredEvidence.length; i++) {
    const clock = checkClock()
    if (clock) {
      return makeResult(caseId, "not_tested", [clock], 0, 0, {
        phase: "witness",
      })
    }

    // Witness slots must be own enumerable data properties: sparse arrays
    // and index accessors are invalid grading, getters never run.
    const itemDescriptor = Object.getOwnPropertyDescriptor(
      requiredEvidenceValue,
      String(i),
    )
    if (
      !(
        itemDescriptor &&
        "value" in itemDescriptor &&
        itemDescriptor.enumerable
      )
    ) {
      return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
        phase: "witness",
      })
    }
    const item = itemDescriptor.value
    if (!isPlainObject(item)) {
      return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
        phase: "witness",
      })
    }

    const fixtureIdField = readDataField(item, "fixtureMessageId")
    const refField = readDataField(item, "ref")
    const quoteField = readDataField(item, "quote")
    const attributionField = readDataField(item, "attribution")

    if (
      fixtureIdField.kind !== "ok" ||
      typeof fixtureIdField.value !== "string" ||
      fixtureIdField.value.length === 0 ||
      refField.kind !== "ok" ||
      !isPlainObject(refField.value) ||
      quoteField.kind !== "ok" ||
      typeof quoteField.value !== "string" ||
      attributionField.kind !== "ok" ||
      typeof attributionField.value !== "string"
    ) {
      return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
        phase: "witness",
      })
    }

    const fixtureMessageId = fixtureIdField.value
    const refIdField = readDataField(refField.value, "id")
    const refMicrosField = readDataField(refField.value, "createdAtMicros")
    if (
      refIdField.kind !== "ok" ||
      typeof refIdField.value !== "string" ||
      refMicrosField.kind !== "ok" ||
      typeof refMicrosField.value !== "string"
    ) {
      return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
        phase: "witness",
      })
    }

    const quote = quoteField.value
    if (quote.length === 0 || !checkStringWellFormed(quote)) {
      return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
        phase: "witness",
      })
    }

    const dtoId = fixtureToDtoId.get(fixtureMessageId)
    const matchingSource =
      dtoId === undefined ? undefined : sourceById.get(dtoId)
    if (
      matchingSource === undefined ||
      !matchingSource.eligible ||
      matchingSource.id !== refIdField.value ||
      matchingSource.createdAtMicros !== refMicrosField.value ||
      matchingSource.attribution !== attributionField.value ||
      matchingSource.text === null ||
      !matchingSource.text.includes(quote)
    ) {
      return makeResult(caseId, "gate_pending", ["invalid_grading"], 0, 0, {
        phase: "witness",
      })
    }

    normalizedWitnesses.push({
      fixtureMessageId,
      ref: { id: refIdField.value, createdAtMicros: refMicrosField.value },
      quote,
      attribution: attributionField.value,
    })
  }

  // ---- 8b. representability of all validated witnesses ----
  for (const witness of normalizedWitnesses) {
    const clock = checkClock()
    if (clock) {
      return makeResult(caseId, "not_tested", [clock], 0, 0, {
        phase: "witness",
      })
    }
    if (witness.quote.length > effectiveMaxQuoteChars) {
      return makeResult(
        caseId,
        "budget_blocked",
        ["witness_unrepresentable"],
        0,
        0,
        {
          phase: "witness",
        },
      )
    }
  }

  // ---- 9. coverage of required evidence ----
  const candidateQuoteIndex = new Map<string, string[]>()
  for (const fact of candidatePayload.facts) {
    const factClock = checkClock()
    if (factClock) {
      return makeResult(
        caseId,
        "not_tested",
        [factClock],
        normalizedWitnesses.length,
        0,
        {
          phase: "witness",
        },
      )
    }
    for (const quote of fact.quotes) {
      const quoteClock = checkClock()
      if (quoteClock) {
        return makeResult(
          caseId,
          "not_tested",
          [quoteClock],
          normalizedWitnesses.length,
          0,
          {
            phase: "witness",
          },
        )
      }
      const key = `${fact.attribution}${NUL}${quote.ref.id}${NUL}${quote.ref.createdAtMicros}`
      const existing = candidateQuoteIndex.get(key)
      if (existing) {
        existing.push(quote.text)
      } else {
        candidateQuoteIndex.set(key, [quote.text])
      }
    }
  }

  let covered = 0
  let firstMissing = -1
  for (let i = 0; i < normalizedWitnesses.length; i++) {
    const clock = checkClock()
    if (clock) {
      return makeResult(
        caseId,
        "not_tested",
        [clock],
        normalizedWitnesses.length,
        covered,
        {
          phase: "witness",
        },
      )
    }

    const w = normalizedWitnesses[i]
    const key = `${w.attribution}${NUL}${w.ref.id}${NUL}${w.ref.createdAtMicros}`
    const candidates = candidateQuoteIndex.get(key)
    let isCovered = false
    if (candidates !== undefined) {
      for (const text of candidates) {
        const candidateClock = checkClock()
        if (candidateClock) {
          return makeResult(
            caseId,
            "not_tested",
            [candidateClock],
            normalizedWitnesses.length,
            covered,
            {
              phase: "witness",
            },
          )
        }
        if (text.includes(w.quote)) {
          isCovered = true
          break
        }
      }
    }
    if (isCovered) {
      covered++
    } else if (firstMissing === -1) {
      firstMissing = i
    }
  }

  if (firstMissing !== -1) {
    return makeResult(
      caseId,
      "reject",
      ["required_evidence_missing"],
      normalizedWitnesses.length,
      covered,
      { phase: "witness", witnessIndex: firstMissing },
    )
  }

  // ---- 10. build judge request ----
  const judgeBuild = buildJudgeRequest(
    {
      sourceEvidence: evidenceSnapshot,
      candidatePayload,
      scope,
      deadlineAtMs,
      signal,
      budget: judgeBudget,
    },
    shared,
  )
  if (judgeBuild.kind !== "ok") {
    if (judgeBuild.kind === "oversize") {
      return makeResult(
        caseId,
        "budget_blocked",
        ["judge_packet_oversize"],
        normalizedWitnesses.length,
        covered,
        {
          phase: "judgeBuild",
        },
      )
    }
    const reason = judgeBuild.reason
    if (reason === "deadline" || reason === "cancelled") {
      return makeResult(
        caseId,
        "not_tested",
        [reason],
        normalizedWitnesses.length,
        covered,
        {
          phase: "judgeBuild",
        },
      )
    }
    return makeResult(
      caseId,
      "gate_pending",
      ["candidate_source_invalid"],
      normalizedWitnesses.length,
      covered,
      { phase: "judgeBuild" },
    )
  }

  const messagesField = readDataField(judgeBuild, "messages")
  if (!(messagesField.kind === "ok" && Array.isArray(messagesField.value))) {
    return makeResult(
      caseId,
      "gate_pending",
      ["candidate_source_invalid"],
      normalizedWitnesses.length,
      covered,
      { phase: "judgeBuild" },
    )
  }
  const messages = messagesField.value as readonly PromptMessage[]
  const call: JudgePortCall = { messages, deadlineAtMs, signal }

  const capturedRequired = normalizedWitnesses.length
  const capturedCovered = covered
  const capturedCaseId = caseId

  // ---- 11. single judge port call ----
  const clockBeforeCall = checkClock()
  if (clockBeforeCall) {
    return makeResult(
      capturedCaseId,
      "not_tested",
      [clockBeforeCall],
      capturedRequired,
      capturedCovered,
      {
        phase: "judgeCall",
      },
    )
  }

  let portResult: unknown
  try {
    portResult = await judgePort(call)
  } catch {
    const clock = checkClock()
    if (clock) {
      return makeResult(
        capturedCaseId,
        "not_tested",
        [clock],
        capturedRequired,
        capturedCovered,
        {
          phase: "judgeCall",
        },
      )
    }
    return makeResult(
      capturedCaseId,
      "transport_error",
      ["transport_error"],
      capturedRequired,
      capturedCovered,
      { phase: "judgeCall" },
    )
  }

  // The clock check runs before the awaited value is inspected at all.
  const clockAfterAwait = checkClock()
  if (clockAfterAwait) {
    return makeResult(
      capturedCaseId,
      "not_tested",
      [clockAfterAwait],
      capturedRequired,
      capturedCovered,
      {
        phase: "judgeCall",
      },
    )
  }

  if (!isPlainObject(portResult)) {
    return makeResult(
      capturedCaseId,
      "inconclusive",
      ["judge_response_invalid"],
      capturedRequired,
      capturedCovered,
      { phase: "judgeCall" },
    )
  }

  const resultKindField = readDataField(portResult, "kind")
  if (
    resultKindField.kind !== "ok" ||
    typeof resultKindField.value !== "string"
  ) {
    return makeResult(
      capturedCaseId,
      "inconclusive",
      ["judge_response_invalid"],
      capturedRequired,
      capturedCovered,
      { phase: "judgeCall" },
    )
  }

  if (resultKindField.value === "unavailable") {
    const reasonField = readDataField(portResult, "reason")
    if (reasonField.kind !== "ok" || typeof reasonField.value !== "string") {
      return makeResult(
        capturedCaseId,
        "inconclusive",
        ["judge_response_invalid"],
        capturedRequired,
        capturedCovered,
        { phase: "judgeCall" },
      )
    }
    if (reasonField.value === "deadline") {
      return makeResult(
        capturedCaseId,
        "not_tested",
        ["deadline"],
        capturedRequired,
        capturedCovered,
        {
          phase: "judgeCall",
        },
      )
    }
    if (reasonField.value === "cancelled") {
      return makeResult(
        capturedCaseId,
        "not_tested",
        ["cancelled"],
        capturedRequired,
        capturedCovered,
        {
          phase: "judgeCall",
        },
      )
    }
    if (reasonField.value === "transport_error") {
      return makeResult(
        capturedCaseId,
        "transport_error",
        ["transport_error"],
        capturedRequired,
        capturedCovered,
        { phase: "judgeCall" },
      )
    }
    return makeResult(
      capturedCaseId,
      "inconclusive",
      ["judge_response_invalid"],
      capturedRequired,
      capturedCovered,
      { phase: "judgeCall" },
    )
  }

  if (resultKindField.value !== "ok") {
    return makeResult(
      capturedCaseId,
      "inconclusive",
      ["judge_response_invalid"],
      capturedRequired,
      capturedCovered,
      { phase: "judgeCall" },
    )
  }

  const contentField = readDataField(portResult, "content")
  if (contentField.kind !== "ok" || typeof contentField.value !== "string") {
    return makeResult(
      capturedCaseId,
      "inconclusive",
      ["judge_response_invalid"],
      capturedRequired,
      capturedCovered,
      { phase: "judgeCall" },
    )
  }

  // ---- 12. parse judge response ----
  const parseResult = parseJudgeResponse(contentField.value)

  // The clock has priority over both parse rejection and acceptance.
  const clockAfterParse = checkClock()
  if (clockAfterParse) {
    return makeResult(
      capturedCaseId,
      "not_tested",
      [clockAfterParse],
      capturedRequired,
      capturedCovered,
      {
        phase: "judgeParse",
      },
    )
  }

  if (parseResult.kind === "reject") {
    const code: EvalFailCode =
      parseResult.reason === "response_oversize"
        ? "judge_response_oversize"
        : "judge_response_invalid"
    return makeResult(
      capturedCaseId,
      "inconclusive",
      [code],
      capturedRequired,
      capturedCovered,
      { phase: "judgeParse" },
    )
  }

  const decision = parseResult.decision
  return makeResult(
    capturedCaseId,
    decision.verdict,
    [],
    capturedRequired,
    capturedCovered,
    { phase: "judgeParse" },
    decision,
  )
}
