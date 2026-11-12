import { createHash } from "node:crypto"
import { types } from "node:util"
import type { PromptMessage } from "../../packages/business/src/external-agent/memory-contract"

export const HTTP_TRANSPORT_VERSION = "t08-http-v1" as const
export const HTTP_ENDPOINT_URL =
  "https://ollama.com/v1/chat/completions" as const
export const HARD_MAX_ELAPSED_MS = 120_000 as const
export const HTTP_MAX_TOKENS = 4096 as const
export const MAX_REQUEST_BODY_UTF8_BYTES = 131_072 as const
export const MAX_RESPONSE_BODY_BYTES = 262_144 as const
export const HTTP_CALL_LIMIT_MAX = 128 as const
export const CANDIDATE_MODELS = Object.freeze([
  "deepseek-v4.1-flash",
  "mimo-v2.6-flash",
  "glm-5.3",
] as const)
export const JUDGE_MODEL_NAME = "kimi-k3" as const

type CandidateModel = (typeof CANDIDATE_MODELS)[number]
export type HttpModel = CandidateModel | typeof JUDGE_MODEL_NAME
export type HttpPurpose = "candidate" | "judge"

export type HttpClientConfig = {
  readonly apiKey: string
  readonly callLimits: { readonly candidate: number; readonly judge: number }
  readonly fetchImpl?: typeof globalThis.fetch
  readonly nowMs?: () => number
  readonly limits?: HttpLimits
}

export type HttpLimits = {
  readonly maxRequestBodyUtf8Bytes?: number
  readonly maxResponseBodyBytes?: number
  readonly maxMessagePacketUtf16?: {
    readonly candidate?: number
    readonly judge?: number
  }
  readonly maxElapsedMs?: number
}

export type HttpUsage = {
  readonly promptTokens: number | "unknown"
  readonly completionTokens: number | "unknown"
  readonly totalTokens: number | "unknown"
}

export type HttpFailReason =
  | "deadline"
  | "cancelled"
  | "transport_error"
  | "invalid_output"

export type HttpFailCode =
  | "budget_exhausted"
  | "busy"
  | "invalid_input"
  | "model_purpose_mismatch"
  | "request_oversize"
  | "deadline_before_start"
  | "deadline_exceeded"
  | "cancelled_before_start"
  | "cancelled"
  | "fetch_rejected"
  | "response_read_rejected"
  | "http_status"
  | "redirected"
  | "response_oversize"
  | "malformed_utf8"
  | "malformed_json"
  | "invalid_response"
  | "missing_choice"
  | "unexpected_tool_call"
  | "returned_model_mismatch"
  | "finish_reason_invalid"
  | "empty_content"
  | "content_oversize"
  | "token_overflow"

export type HttpAttempt = {
  readonly purpose: HttpPurpose | null
  readonly requestedModel: HttpModel | null
  readonly modelMatch: boolean | null
  readonly returnedModel: HttpModel | null
  readonly finishReason:
    | "stop"
    | "length"
    | "tool_calls"
    | "function_call"
    | "content_filter"
    | null
  readonly status: number | null
  readonly requestHash: string | null
  readonly contentGroupHash: string | null
  readonly responseHash: string | null
  readonly requestBytes: number | "unknown"
  readonly responseBytes: number | "unknown"
  readonly responseComplete: boolean
  readonly elapsedMs: number | "unknown"
  readonly attempts: 0 | 1
  readonly usage: HttpUsage
}

export type HttpResult =
  | {
      readonly kind: "ok"
      readonly content: string
      readonly attempt: HttpAttempt
    }
  | {
      readonly kind: "unavailable"
      readonly reason: HttpFailReason
      readonly code: HttpFailCode
      readonly attempt: HttpAttempt
    }

export type HttpCounters = {
  readonly busy: boolean
  readonly candidate: {
    readonly limit: number
    readonly used: number
    readonly attempts: number
  }
  readonly judge: {
    readonly limit: number
    readonly used: number
    readonly attempts: number
  }
}

export type HttpCompleteInput = {
  readonly purpose: HttpPurpose
  readonly model: HttpModel
  readonly messages: readonly PromptMessage[]
  readonly deadlineAtMs: number
  readonly signal?: AbortSignal
}

const CONFIG_ERROR_MESSAGE = "Invalid dialog memory HTTP client configuration"

const UNKNOWN_USAGE: HttpUsage = {
  promptTokens: "unknown",
  completionTokens: "unknown",
  totalTokens: "unknown",
}

const HARD_PACKET_CANDIDATE = 24_000
const HARD_PACKET_JUDGE = 64_000
const INVALID_CREDENTIAL_CHARACTER_RE = /[^\x21-\x7e]/
const CONTENT_LENGTH_RE = /^\d{1,16}$/

const isAllowlistedModel = (value: string): value is HttpModel =>
  (CANDIDATE_MODELS as readonly string[]).includes(value) ||
  value === JUDGE_MODEL_NAME

const isHttpPurpose = (value: unknown): value is HttpPurpose =>
  value === "candidate" || value === "judge"

const isFiniteSafeInt = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  Number.isFinite(value)

const isValidClockValue = (value: unknown): value is number =>
  isFiniteSafeInt(value) && value >= 0

const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex")

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false
  }
  // Proxy check always precedes any reflection so revoked proxies never throw.
  if (types.isProxy(value) || Array.isArray(value)) {
    return false
  }
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

type OwnData =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }
  | { readonly kind: "value"; readonly value: unknown }

const readOwnData = (container: object, key: string): OwnData => {
  const descriptor = Object.getOwnPropertyDescriptor(container, key)
  if (descriptor === undefined) {
    return { kind: "absent" }
  }
  if (!("value" in descriptor) || descriptor.enumerable !== true) {
    return { kind: "invalid" }
  }
  return { kind: "value", value: descriptor.value }
}

const readOwnValue = (container: object, key: string): unknown => {
  const field = readOwnData(container, key)
  return field.kind === "value" ? field.value : undefined
}

const validateApiKey = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(CONFIG_ERROR_MESSAGE)
  }
  if (INVALID_CREDENTIAL_CHARACTER_RE.test(value)) {
    throw new RangeError(CONFIG_ERROR_MESSAGE)
  }
  return value
}

const validateCallLimits = (
  value: unknown,
): { readonly candidate: number; readonly judge: number } => {
  if (!isPlainObject(value)) {
    throw new RangeError(CONFIG_ERROR_MESSAGE)
  }
  const candidateField = readOwnData(value, "candidate")
  const judgeField = readOwnData(value, "judge")
  if (candidateField.kind !== "value" || judgeField.kind !== "value") {
    throw new RangeError(CONFIG_ERROR_MESSAGE)
  }
  const candidate = candidateField.value
  const judge = judgeField.value
  if (
    !isFiniteSafeInt(candidate) ||
    candidate < 0 ||
    candidate > HTTP_CALL_LIMIT_MAX ||
    !isFiniteSafeInt(judge) ||
    judge < 0 ||
    judge > HTTP_CALL_LIMIT_MAX
  ) {
    throw new RangeError(CONFIG_ERROR_MESSAGE)
  }
  return { candidate, judge }
}

type ResolvedLimits = {
  maxRequestBodyUtf8Bytes: number
  maxResponseBodyBytes: number
  maxMessagePacketUtf16: { candidate: number; judge: number }
  maxElapsedMs: number
}

const validateLimits = (value: unknown): ResolvedLimits => {
  let maxRequestBodyUtf8Bytes: number = MAX_REQUEST_BODY_UTF8_BYTES
  let maxResponseBodyBytes: number = MAX_RESPONSE_BODY_BYTES
  let packetCandidate: number = HARD_PACKET_CANDIDATE
  let packetJudge: number = HARD_PACKET_JUDGE
  let maxElapsedMs: number = HARD_MAX_ELAPSED_MS

  if (value === undefined) {
    return {
      maxRequestBodyUtf8Bytes,
      maxResponseBodyBytes,
      maxMessagePacketUtf16: { candidate: packetCandidate, judge: packetJudge },
      maxElapsedMs,
    }
  }
  if (!isPlainObject(value)) {
    throw new RangeError(CONFIG_ERROR_MESSAGE)
  }

  const pickLowering = (key: string, hard: number): number => {
    const field = readOwnData(value, key)
    if (field.kind === "invalid") {
      throw new RangeError(CONFIG_ERROR_MESSAGE)
    }
    if (field.kind === "absent" || field.value === undefined) {
      return hard
    }
    if (
      !isFiniteSafeInt(field.value) ||
      field.value <= 0 ||
      field.value > hard
    ) {
      throw new RangeError(CONFIG_ERROR_MESSAGE)
    }
    return field.value
  }

  maxRequestBodyUtf8Bytes = pickLowering(
    "maxRequestBodyUtf8Bytes",
    MAX_REQUEST_BODY_UTF8_BYTES,
  )
  maxResponseBodyBytes = pickLowering(
    "maxResponseBodyBytes",
    MAX_RESPONSE_BODY_BYTES,
  )
  maxElapsedMs = pickLowering("maxElapsedMs", HARD_MAX_ELAPSED_MS)

  const packetField = readOwnData(value, "maxMessagePacketUtf16")
  if (packetField.kind === "invalid") {
    throw new RangeError(CONFIG_ERROR_MESSAGE)
  }
  if (packetField.kind === "value" && packetField.value !== undefined) {
    const packet = packetField.value
    if (!isPlainObject(packet)) {
      throw new RangeError(CONFIG_ERROR_MESSAGE)
    }
    const candidateField = readOwnData(packet, "candidate")
    if (candidateField.kind === "invalid") {
      throw new RangeError(CONFIG_ERROR_MESSAGE)
    }
    if (candidateField.kind === "value" && candidateField.value !== undefined) {
      const candidateCap = candidateField.value
      if (
        !isFiniteSafeInt(candidateCap) ||
        candidateCap <= 0 ||
        candidateCap > HARD_PACKET_CANDIDATE
      ) {
        throw new RangeError(CONFIG_ERROR_MESSAGE)
      }
      packetCandidate = candidateCap
    }
    const judgeField = readOwnData(packet, "judge")
    if (judgeField.kind === "invalid") {
      throw new RangeError(CONFIG_ERROR_MESSAGE)
    }
    if (judgeField.kind === "value" && judgeField.value !== undefined) {
      const judgeCap = judgeField.value
      if (
        !isFiniteSafeInt(judgeCap) ||
        judgeCap <= 0 ||
        judgeCap > HARD_PACKET_JUDGE
      ) {
        throw new RangeError(CONFIG_ERROR_MESSAGE)
      }
      packetJudge = judgeCap
    }
  }

  return {
    maxRequestBodyUtf8Bytes,
    maxResponseBodyBytes,
    maxMessagePacketUtf16: { candidate: packetCandidate, judge: packetJudge },
    maxElapsedMs,
  }
}

const mapCodeToReason = (code: HttpFailCode): HttpFailReason => {
  switch (code) {
    case "budget_exhausted":
    case "busy":
    case "fetch_rejected":
    case "response_read_rejected":
    case "http_status":
    case "redirected":
      return "transport_error"
    case "deadline_before_start":
    case "deadline_exceeded":
      return "deadline"
    case "cancelled_before_start":
    case "cancelled":
      return "cancelled"
    default:
      return "invalid_output"
  }
}

const zeroAttempt = (
  purpose: HttpPurpose | null,
  requestedModel: HttpModel | null,
  meta?: {
    readonly requestHash: string
    readonly contentGroupHash: string
    readonly requestBytes: number
  },
): HttpAttempt => ({
  purpose,
  requestedModel,
  modelMatch: null,
  returnedModel: null,
  finishReason: null,
  status: null,
  requestHash: meta?.requestHash ?? null,
  contentGroupHash: meta?.contentGroupHash ?? null,
  responseHash: null,
  requestBytes: meta?.requestBytes ?? "unknown",
  responseBytes: "unknown",
  responseComplete: false,
  elapsedMs: 0,
  attempts: 0,
  usage: { ...UNKNOWN_USAGE },
})

const earlyDeny = (
  code: HttpFailCode,
  purpose: HttpPurpose | null,
  requestedModel: HttpModel | null,
  meta?: {
    readonly requestHash: string
    readonly contentGroupHash: string
    readonly requestBytes: number
  },
): HttpResult => ({
  kind: "unavailable",
  reason: mapCodeToReason(code),
  code,
  attempt: zeroAttempt(purpose, requestedModel, meta),
})

type ValidateResult =
  | {
      readonly kind: "ok"
      readonly purpose: HttpPurpose
      readonly model: HttpModel
      readonly messages: readonly [PromptMessage, PromptMessage]
      readonly deadlineAtMs: number
      readonly callerSignal: AbortSignal | undefined
    }
  | {
      readonly kind: "fail"
      readonly code: "invalid_input" | "model_purpose_mismatch"
      readonly purpose: HttpPurpose | null
      readonly requestedModel: HttpModel | null
    }

const failInput = (
  code: "invalid_input" | "model_purpose_mismatch",
  purpose: HttpPurpose | null,
  requestedModel: HttpModel | null,
): ValidateResult => ({ kind: "fail", code, purpose, requestedModel })

const validateInput = (input: HttpCompleteInput): ValidateResult => {
  if (!isPlainObject(input)) {
    return failInput("invalid_input", null, null)
  }

  const purposeField = readOwnData(input, "purpose")
  const modelField = readOwnData(input, "model")
  const messagesField = readOwnData(input, "messages")
  const deadlineField = readOwnData(input, "deadlineAtMs")
  const signalField = readOwnData(input, "signal")

  if (
    purposeField.kind !== "value" ||
    modelField.kind !== "value" ||
    messagesField.kind !== "value" ||
    deadlineField.kind !== "value" ||
    signalField.kind === "invalid"
  ) {
    return failInput("invalid_input", null, null)
  }

  const purpose = purposeField.value
  if (!isHttpPurpose(purpose)) {
    return failInput("invalid_input", null, null)
  }
  const model = modelField.value
  if (typeof model !== "string") {
    return failInput("invalid_input", purpose, null)
  }
  const knownModel: HttpModel | null = isAllowlistedModel(model) ? model : null

  if (
    (purpose === "candidate" &&
      !(CANDIDATE_MODELS as readonly string[]).includes(model)) ||
    (purpose === "judge" && model !== JUDGE_MODEL_NAME)
  ) {
    return failInput("model_purpose_mismatch", purpose, knownModel)
  }

  const deadlineAtMs = deadlineField.value
  if (!isFiniteSafeInt(deadlineAtMs)) {
    return failInput("invalid_input", purpose, knownModel)
  }

  let callerSignal: AbortSignal | undefined
  if (signalField.kind === "value" && signalField.value !== undefined) {
    const signalValue = signalField.value
    if (
      typeof signalValue !== "object" ||
      signalValue === null ||
      types.isProxy(signalValue) ||
      !(signalValue instanceof AbortSignal)
    ) {
      return failInput("invalid_input", purpose, knownModel)
    }
    callerSignal = signalValue
  }

  const messages = messagesField.value
  if (
    messages === null ||
    typeof messages !== "object" ||
    types.isProxy(messages) ||
    !Array.isArray(messages) ||
    messages.length !== 2
  ) {
    return failInput("invalid_input", purpose, knownModel)
  }

  const copy: [PromptMessage, PromptMessage] = [
    { role: "system", content: "" },
    { role: "user", content: "" },
  ]
  for (let index = 0; index < 2; index++) {
    const elementField = readOwnData(messages, String(index))
    if (elementField.kind !== "value") {
      return failInput("invalid_input", purpose, knownModel)
    }
    const message = elementField.value
    if (!isPlainObject(message)) {
      return failInput("invalid_input", purpose, knownModel)
    }
    const roleField = readOwnData(message, "role")
    const contentField = readOwnData(message, "content")
    if (roleField.kind !== "value" || contentField.kind !== "value") {
      return failInput("invalid_input", purpose, knownModel)
    }
    const role = roleField.value
    const content = contentField.value
    if (typeof role !== "string" || typeof content !== "string") {
      return failInput("invalid_input", purpose, knownModel)
    }
    const expectedRole = index === 0 ? "system" : "user"
    if (role !== expectedRole) {
      return failInput("invalid_input", purpose, knownModel)
    }
    copy[index] = { role: expectedRole, content }
  }

  return {
    kind: "ok",
    purpose,
    model: knownModel as HttpModel,
    messages: copy,
    deadlineAtMs,
    callerSignal,
  }
}

type StopCause = "deadline" | "cancelled"

class InternalStop extends Error {
  readonly stopCause: StopCause
  constructor(stopCause: StopCause) {
    super("internal stop")
    this.name = "InternalStop"
    this.stopCause = stopCause
  }
}

const raceWithGate = <T>(
  operation: Promise<T>,
  gate: AbortSignal,
  getStopCause: () => StopCause | null,
  defaultCause: StopCause,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const makeStop = (): InternalStop =>
      new InternalStop(getStopCause() ?? defaultCause)
    const detach = () => {
      gate.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      reject(makeStop())
    }
    gate.addEventListener("abort", onAbort, { once: true })
    // Handlers attach unconditionally and immediately, so an already-rejected
    // operation is still observed even when the gate is already aborted.
    operation.then(
      (value) => {
        detach()
        if (gate.aborted) {
          reject(makeStop())
        } else {
          resolve(value)
        }
      },
      (error: unknown) => {
        detach()
        if (gate.aborted) {
          reject(makeStop())
        } else {
          reject(error)
        }
      },
    )
    if (gate.aborted) {
      detach()
      reject(makeStop())
    }
  })

const observeLate = (value: unknown): void => {
  if (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    ;(value as PromiseLike<unknown>).then(undefined, () => {
      // Late rejections are observed only to suppress unhandled rejections.
    })
  }
}

const concatChunks = (
  chunks: readonly Uint8Array[],
  totalLength: number,
): Uint8Array => {
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export const createDialogMemoryHttpClient = (config: HttpClientConfig) => {
  if (!isPlainObject(config)) {
    throw new RangeError(CONFIG_ERROR_MESSAGE)
  }
  const apiKeyField = readOwnData(config, "apiKey")
  if (apiKeyField.kind !== "value") {
    throw new RangeError(CONFIG_ERROR_MESSAGE)
  }
  const apiKey = validateApiKey(apiKeyField.value)

  const callLimitsField = readOwnData(config, "callLimits")
  if (callLimitsField.kind !== "value") {
    throw new RangeError(CONFIG_ERROR_MESSAGE)
  }
  const callLimits = validateCallLimits(callLimitsField.value)

  const limitsField = readOwnData(config, "limits")
  if (limitsField.kind === "invalid") {
    throw new RangeError(CONFIG_ERROR_MESSAGE)
  }
  const limits = validateLimits(
    limitsField.kind === "value" ? limitsField.value : undefined,
  )

  const pickCallback = <T>(key: string, fallback: T): T => {
    const field = readOwnData(config, key)
    if (field.kind === "invalid") {
      throw new RangeError(CONFIG_ERROR_MESSAGE)
    }
    if (field.kind === "absent" || field.value === undefined) {
      return fallback
    }
    if (typeof field.value !== "function") {
      throw new RangeError(CONFIG_ERROR_MESSAGE)
    }
    return field.value as T
  }
  const nowMs = pickCallback("nowMs", () => Date.now())
  const fetchImpl = pickCallback(
    "fetchImpl",
    (globalThis.fetch as typeof globalThis.fetch).bind(globalThis),
  )

  let busy = false
  const used = { candidate: 0, judge: 0 }
  const attempts = { candidate: 0, judge: 0 }

  const getCounters = (): HttpCounters => ({
    busy,
    candidate: {
      limit: callLimits.candidate,
      used: used.candidate,
      attempts: attempts.candidate,
    },
    judge: {
      limit: callLimits.judge,
      used: used.judge,
      attempts: attempts.judge,
    },
  })

  const complete = async (input: HttpCompleteInput): Promise<HttpResult> => {
    const validated = validateInput(input)
    if (validated.kind === "fail") {
      return earlyDeny(
        validated.code,
        validated.purpose,
        validated.requestedModel,
      )
    }
    const purpose = validated.purpose
    const model = validated.model
    const callerSignal = validated.callerSignal

    // Body and clock are validated before busy/budget so a zero budget
    // can never mask an invalid injected clock.
    const clockStart = nowMs()
    if (!isValidClockValue(clockStart)) {
      return earlyDeny("invalid_input", purpose, model)
    }

    // Canonical body and hash group are fully captured before any await / charge.
    const cloned: [PromptMessage, PromptMessage] = [
      { role: "system", content: validated.messages[0].content },
      { role: "user", content: validated.messages[1].content },
    ]
    const canonicalBodyString = JSON.stringify({
      model,
      messages: cloned,
      stream: false,
      temperature: 0,
      max_tokens: HTTP_MAX_TOKENS,
    })
    const contentGroupString = JSON.stringify({ messages: cloned })
    const request = {
      requestHash: sha256(canonicalBodyString),
      contentGroupHash: sha256(contentGroupString),
      requestBytes: Buffer.byteLength(canonicalBodyString, "utf8"),
    }

    if (contentGroupString.length > limits.maxMessagePacketUtf16[purpose]) {
      return earlyDeny("request_oversize", purpose, model, request)
    }
    if (request.requestBytes > limits.maxRequestBodyUtf8Bytes) {
      return earlyDeny("request_oversize", purpose, model, request)
    }

    if (busy) {
      return earlyDeny("busy", purpose, model, request)
    }
    if (used[purpose] >= callLimits[purpose]) {
      return earlyDeny("budget_exhausted", purpose, model, request)
    }

    const effectiveDeadline = Math.min(
      clockStart + limits.maxElapsedMs,
      validated.deadlineAtMs,
    )

    const clockFinal = nowMs()
    if (!isValidClockValue(clockFinal)) {
      return earlyDeny("invalid_input", purpose, model, request)
    }
    // Caller cancel outranks an already-expired deadline when both hold pre-start.
    if (callerSignal?.aborted) {
      return earlyDeny("cancelled_before_start", purpose, model, request)
    }
    if (clockFinal >= effectiveDeadline) {
      return earlyDeny("deadline_before_start", purpose, model, request)
    }

    // Only the busy reservation and the start clock happen here; used and
    // attempts are charged synchronously right before the actual fetchImpl
    // invocation, so a call that never fetches can never spend a budget.
    busy = true
    const startMs = clockFinal

    const state = {
      purpose,
      requestedModel: model as HttpModel | null,
      modelMatch: null as boolean | null,
      returnedModel: null as HttpModel | null,
      finishReason: null as HttpAttempt["finishReason"],
      status: null as number | null,
      requestHash: request.requestHash,
      contentGroupHash: request.contentGroupHash,
      responseHash: null as string | null,
      requestBytes: request.requestBytes,
      responseBytes: "unknown" as number | "unknown",
      responseComplete: false,
      usage: undefined as HttpUsage | undefined,
    }

    let stopCause: StopCause | null = null
    let didFetch = false
    const controller = new AbortController()
    // Real Node timer bounds the whole fetch+read even with a frozen injected
    // clock; the remaining budget is measured from the latest validated clock
    // read so validation progress cannot stretch the effective deadline.
    const remainingMs = Math.max(1, effectiveDeadline - clockFinal)
    const timer = setTimeout(() => {
      if (stopCause === null) {
        stopCause = "deadline"
      }
      controller.abort()
    }, remainingMs)

    const onCallerAbort = () => {
      if (stopCause === null) {
        stopCause = "cancelled"
      }
      controller.abort()
    }
    let callerSubscribed = false
    if (callerSignal !== undefined) {
      callerSignal.addEventListener("abort", onCallerAbort)
      callerSubscribed = true
      // Recheck after subscribe so an abort between check and subscribe is not lost.
      if (callerSignal.aborted) {
        onCallerAbort()
      }
    }

    const detectStop = (): StopCause | null => {
      if (stopCause !== null) {
        return stopCause
      }
      // Simultaneous caller abort and expiry resolve to cancelled; otherwise
      // the first recorded stop-cause persists.
      if (callerSignal?.aborted) {
        stopCause = "cancelled"
        return stopCause
      }
      const t = nowMs()
      if (!isValidClockValue(t) || t >= effectiveDeadline) {
        stopCause = "deadline"
        return stopCause
      }
      return null
    }
    const throwIfStopped = (): void => {
      const stop = detectStop()
      if (stop !== null) {
        throw new InternalStop(stop)
      }
    }

    const elapsedNow = (): number | "unknown" => {
      const t = nowMs()
      if (!isValidClockValue(t)) {
        return "unknown"
      }
      const diff = t - startMs
      if (!Number.isSafeInteger(diff) || diff < 0) {
        return "unknown"
      }
      return diff
    }

    const snapshot = (): HttpAttempt => ({
      purpose: state.purpose,
      requestedModel: state.requestedModel,
      modelMatch: state.modelMatch,
      returnedModel: state.returnedModel,
      finishReason: state.finishReason,
      status: state.status,
      requestHash: state.requestHash,
      contentGroupHash: state.contentGroupHash,
      responseHash: state.responseHash,
      requestBytes: state.requestBytes,
      responseBytes: state.responseBytes,
      responseComplete: state.responseComplete,
      elapsedMs: didFetch ? elapsedNow() : 0,
      attempts: didFetch ? 1 : 0,
      usage: state.usage ?? { ...UNKNOWN_USAGE },
    })

    const deny = (code: HttpFailCode): HttpResult => ({
      kind: "unavailable",
      reason: mapCodeToReason(code),
      code,
      attempt: snapshot(),
    })

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let responseRef: Response | undefined

    const cleanup = (): void => {
      clearTimeout(timer)
      if (callerSubscribed && callerSignal !== undefined) {
        try {
          callerSignal.removeEventListener("abort", onCallerAbort)
        } catch {
          // cleanup failures never escape
        }
      }
      if (reader !== undefined) {
        try {
          observeLate(reader.cancel())
        } catch {
          // cancel() may throw or never settle: fire-and-observe only
        }
        try {
          reader.releaseLock()
        } catch {
          // releaseLock failures never escape
        }
      } else if (responseRef !== undefined && !state.responseComplete) {
        // Unread and unlocked body: cancel it without reading, locking, or
        // awaiting; the returned promise may intentionally never settle.
        try {
          const body: unknown = responseRef.body
          if (
            body !== null &&
            body !== undefined &&
            typeof (body as { cancel?: unknown }).cancel === "function"
          ) {
            observeLate((body as { cancel: () => unknown }).cancel())
          }
        } catch {
          // body access failures never escape cleanup
        }
      }
      if (!state.responseComplete) {
        // Every unfinished path aborts the underlying request exactly once
        // here; this runs after the result is computed and cannot reclassify
        // an already-computed HTTP or protocol result.
        try {
          controller.abort()
        } catch {
          // abort failures never escape cleanup
        }
      }
      busy = false
    }

    let stage: "fetch" | "shape" | "read" | "decode" | "parse" = "fetch"

    try {
      // Final stop guard; nothing async may separate it from the charged fetch.
      throwIfStopped()
      const fetchInit: RequestInit = {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: canonicalBodyString,
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
      }
      // Charge synchronously immediately before the actual fetchImpl call:
      // no await separates the final guard, the charge, and the invocation.
      used[purpose] += 1
      attempts[purpose] += 1
      didFetch = true
      const response = await raceWithGate(
        fetchImpl(HTTP_ENDPOINT_URL, fetchInit),
        controller.signal,
        () => stopCause,
        "deadline",
      )
      responseRef = response as Response
      throwIfStopped()

      stage = "shape"
      const statusValue: unknown = response.status
      if (
        typeof statusValue !== "number" ||
        !Number.isInteger(statusValue) ||
        statusValue < 100 ||
        statusValue > 599
      ) {
        return deny("invalid_response")
      }
      const status = statusValue
      state.status = status

      const redirectedValue: unknown = response.redirected
      if (redirectedValue === true || (status >= 300 && status < 400)) {
        return deny("redirected")
      }
      if (status < 200 || status > 299) {
        // Error bodies are never read, parsed, or echoed.
        return deny("http_status")
      }

      const headersValue: unknown = response.headers
      let contentLength: string | null = null
      if (
        typeof headersValue === "object" &&
        headersValue !== null &&
        typeof (headersValue as { get?: unknown }).get === "function"
      ) {
        const rawHeader: unknown = (headersValue as Headers).get(
          "Content-Length",
        )
        if (typeof rawHeader === "string") {
          contentLength = rawHeader
        }
      }
      // Content-Length is only an early check; the byte cap below always applies.
      if (contentLength !== null && CONTENT_LENGTH_RE.test(contentLength)) {
        const declared = Number(contentLength)
        if (declared > limits.maxResponseBodyBytes) {
          return deny("response_oversize")
        }
      }

      stage = "read"
      let rawBytes: Uint8Array
      const bodyValue: unknown = response.body
      if (bodyValue === null || bodyValue === undefined) {
        rawBytes = new Uint8Array(0)
        state.responseBytes = 0
        state.responseComplete = true
        state.responseHash = sha256(rawBytes)
      } else {
        reader = (bodyValue as ReadableStream<Uint8Array>).getReader()
        const chunks: Uint8Array[] = []
        let totalBytes = 0
        while (true) {
          const part = await raceWithGate(
            reader.read(),
            controller.signal,
            () => stopCause,
            "deadline",
          )
          // Clock/abort priority after every read, before starting the next one.
          throwIfStopped()
          if (part === null || typeof part !== "object") {
            throw new Error("invalid read result")
          }
          if (part.done === true) {
            break
          }
          const chunk: unknown = part.value
          if (!(chunk instanceof Uint8Array)) {
            throw new Error("invalid chunk")
          }
          if (chunk.byteLength > 0) {
            if (totalBytes + chunk.byteLength > limits.maxResponseBodyBytes) {
              // Abort the underlying fetch. Reported bytes are the retained
              // observed prefix only; incomplete responses are never hashed.
              controller.abort()
              state.responseBytes = totalBytes
              state.responseComplete = false
              state.responseHash = null
              return deny("response_oversize")
            }
            chunks.push(chunk.subarray(0, chunk.byteLength))
            totalBytes += chunk.byteLength
            state.responseBytes = totalBytes
          }
        }
        rawBytes = concatChunks(chunks, totalBytes)
        state.responseBytes = totalBytes
        state.responseComplete = true
        state.responseHash = sha256(rawBytes)
      }
      throwIfStopped()

      stage = "decode"
      const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes)
      throwIfStopped()

      stage = "parse"
      const parsed: unknown = JSON.parse(text)
      throwIfStopped()

      if (!isPlainObject(parsed)) {
        return deny("invalid_response")
      }

      const choicesValue = readOwnValue(parsed, "choices")
      if (!Array.isArray(choicesValue)) {
        return deny("invalid_response")
      }
      if (choicesValue.length !== 1) {
        return deny("missing_choice")
      }
      const choice: unknown = choicesValue[0]
      if (!isPlainObject(choice)) {
        return deny("missing_choice")
      }

      const returnedModelValue = readOwnValue(parsed, "model")
      if (typeof returnedModelValue !== "string") {
        return deny("invalid_response")
      }
      if (returnedModelValue !== model) {
        // Mismatched returned models are never echoed, even allowlisted ones.
        state.modelMatch = false
        state.returnedModel = null
        return deny("returned_model_mismatch")
      }
      state.modelMatch = true
      state.returnedModel = model

      const messageValue = readOwnValue(choice, "message")
      if (!isPlainObject(messageValue)) {
        return deny("invalid_response")
      }
      const role = readOwnValue(messageValue, "role")
      if (role !== "assistant") {
        return deny("invalid_response")
      }
      const content = readOwnValue(messageValue, "content")
      if (typeof content !== "string") {
        return deny("invalid_response")
      }

      const toolCalls = readOwnValue(messageValue, "tool_calls")
      if (
        toolCalls !== undefined &&
        toolCalls !== null &&
        (!Array.isArray(toolCalls) || toolCalls.length !== 0)
      ) {
        return deny("unexpected_tool_call")
      }
      const functionCall = readOwnValue(messageValue, "function_call")
      if (functionCall !== undefined && functionCall !== null) {
        return deny("unexpected_tool_call")
      }

      const finishRaw = readOwnValue(choice, "finish_reason")
      state.finishReason =
        finishRaw === "stop" ||
        finishRaw === "length" ||
        finishRaw === "tool_calls" ||
        finishRaw === "function_call" ||
        finishRaw === "content_filter"
          ? finishRaw
          : null
      if (state.finishReason !== "stop") {
        return deny("finish_reason_invalid")
      }

      if (content.trim().length === 0) {
        return deny("empty_content")
      }

      const contentUtf8Bytes = Buffer.byteLength(content, "utf8")
      if (purpose === "candidate") {
        if (content.length > 20_000 || contentUtf8Bytes > 65_536) {
          return deny("content_oversize")
        }
      } else if (contentUtf8Bytes > 8192) {
        return deny("content_oversize")
      }

      const usageField = readOwnValue(parsed, "usage")
      let promptTokens: number | "unknown" = "unknown"
      let completionTokens: number | "unknown" = "unknown"
      let totalTokens: number | "unknown" = "unknown"
      if (
        typeof usageField === "object" &&
        usageField !== null &&
        !Array.isArray(usageField)
      ) {
        const pt = readOwnValue(usageField, "prompt_tokens")
        if (isFiniteSafeInt(pt) && pt >= 0) {
          promptTokens = pt
        }
        const ct = readOwnValue(usageField, "completion_tokens")
        if (isFiniteSafeInt(ct) && ct >= 0) {
          completionTokens = ct
        }
        const tt = readOwnValue(usageField, "total_tokens")
        if (isFiniteSafeInt(tt) && tt >= 0) {
          totalTokens = tt
        }
      }
      state.usage = { promptTokens, completionTokens, totalTokens }

      if (
        typeof completionTokens === "number" &&
        completionTokens > HTTP_MAX_TOKENS
      ) {
        return deny("token_overflow")
      }

      throwIfStopped()
      return { kind: "ok", content, attempt: snapshot() }
    } catch (raw: unknown) {
      const stop: StopCause | null =
        raw instanceof InternalStop ? raw.stopCause : detectStop()
      if (!didFetch && stop !== null) {
        // Stopped after the checks but before fetchImpl ran: this call spent
        // no budget, so it keeps the before-start classification and the
        // already-captured canonical request hashes.
        return earlyDeny(
          stop === "cancelled"
            ? "cancelled_before_start"
            : "deadline_before_start",
          purpose,
          model,
          request,
        )
      }
      // Stop causes outrank stage errors on every failed stage as well.
      if (stop !== null) {
        return deny(stop === "cancelled" ? "cancelled" : "deadline_exceeded")
      }
      if (stage === "fetch") {
        return deny("fetch_rejected")
      }
      if (stage === "read") {
        return deny("response_read_rejected")
      }
      if (stage === "decode") {
        return deny("malformed_utf8")
      }
      if (stage === "parse") {
        return deny("malformed_json")
      }
      return deny("invalid_response")
    } finally {
      try {
        cleanup()
      } catch {
        // cleanup failures never override the computed result
      }
      busy = false
    }
  }

  return { complete, getCounters }
}
