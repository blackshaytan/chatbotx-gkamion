/**
 * Bounded dialog memory recovery service.
 *
 * The service performs a full reverse-chronological scan of the conversation
 * history, classifies an existing stored memory against the captured source,
 * and only invokes the injected summarizer/validator when the raw context does
 * not fit the output budget. It never mutates the caller's input objects.
 *
 * This module is not activated by itself; T07/T09/T10 integration and any
 * feature flagging are outside the scope of T05.
 *
 * Conservative default budgets (overridable via `config.budgets`) which are
 * also hard upper bounds; larger values are rejected in the constructor:
 *   maxPageFetches: 200      maxCycles: 2
 *   pageSize: 100            maxLlmCalls: 2
 *   maxScanItems: 20000      maxBatchItems: 100
 *   maxScanLogicalBytes: 16 MiB   maxBatchEncodedChars: 24000
 *   maxOutputEncodedChars: 20000   maxStoredJsonBytes: 8 MiB
 */

import type {
  DialogMemoryConfig,
  DialogMemoryCursor,
  DialogMemoryDto,
  DialogMemoryMessageDto,
  DialogMemoryScope,
  DialogMemorySnapshotResult,
  DialogMemoryToken,
} from "@chatbotx.io/database/repositories"
import {
  buildManifest,
  compareRefsAsc,
  coverageRefOf,
  decodeStoredRecord,
  diffManifest,
  encodeStoredRecord,
  type FingerprintedRef,
  isFullCoverage,
  MANIFEST_VERSION,
  type MessageRef,
  STORAGE_VERSION,
  type StoredDialogMemoryRecord,
} from "./memory-coverage"
import type {
  DialogMemoryBudgets,
  DialogMemoryContextResult,
  DialogMemoryContextUnavailableReason,
  DialogMemoryCounters,
  DialogMemoryRepositoryPort,
  DialogMemoryService,
  DialogMemoryServiceConfig,
  SemanticValidatorPort,
  SummarizerPort,
} from "./memory-service-types"

const DEFAULT_BUDGETS: DialogMemoryBudgets = {
  maxPageFetches: 200,
  pageSize: 100,
  maxScanItems: 20_000,
  maxScanLogicalBytes: 16 * 1024 * 1024,
  maxLlmCalls: 2,
  maxCycles: 2,
  maxBatchItems: 100,
  maxBatchEncodedChars: 24_000,
  maxOutputEncodedChars: 20_000,
  maxStoredJsonBytes: 8 * 1024 * 1024,
}

/** Hard upper bounds; no deployment may raise these through config. */
const BUDGET_UPPER_BOUNDS: DialogMemoryBudgets = { ...DEFAULT_BUDGETS }

const validateBudgets = (
  partial: Partial<DialogMemoryBudgets> | undefined,
): DialogMemoryBudgets => {
  const budgets = { ...DEFAULT_BUDGETS, ...partial }
  for (const key of Object.keys(budgets) as Array<keyof DialogMemoryBudgets>) {
    const value = budgets[key]
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      throw new Error(
        `dialog-memory: budget ${key} must be a positive safe integer`,
      )
    }
    if (value > BUDGET_UPPER_BOUNDS[key]) {
      throw new Error(
        `dialog-memory: budget ${key} exceeds the hard upper bound ${BUDGET_UPPER_BOUNDS[key]}`,
      )
    }
  }
  return budgets
}

const utf8Encoder = new TextEncoder()

const utf8Bytes = (value: string): number => utf8Encoder.encode(value).length

const sameRef = (a: MessageRef | null, b: MessageRef | null): boolean => {
  if (a === null || b === null) {
    return a === b
  }
  return a.id === b.id && a.createdAtMicros === b.createdAtMicros
}

const sameToken = (a: DialogMemoryToken, b: DialogMemoryToken): boolean =>
  a.sourceRevision === b.sourceRevision &&
  a.memoryVersion === b.memoryVersion &&
  a.topologyEpoch === b.topologyEpoch

const sameScope = (a: DialogMemoryScope, b: DialogMemoryScope): boolean =>
  a.workspaceId === b.workspaceId &&
  a.conversationId === b.conversationId &&
  a.expectedContactId === b.expectedContactId

const sameConfig = (a: DialogMemoryConfig, b: DialogMemoryConfig): boolean =>
  a.schemaVersion === b.schemaVersion &&
  a.promptVersion === b.promptVersion &&
  a.model === b.model &&
  a.provider === b.provider

type StopStatus = "deadline" | "cancelled"

const checkDeadline = (
  nowMs: () => number,
  deadlineAtMs: number,
  signal: AbortSignal | undefined,
): StopStatus | null => {
  if (signal?.aborted) {
    return "cancelled"
  }
  if (nowMs() >= deadlineAtMs) {
    return "deadline"
  }
  return null
}

type BoundedOutcome<T> =
  | { kind: "settled"; value: T }
  | { kind: "thrown" }
  | { kind: "stopped"; status: StopStatus }

/**
 * Bounded await for injected ports. Never starts the task if the absolute
 * deadline has passed or the signal is already aborted, races the task against
 * the remaining deadline and the abort signal, cleans up its timer and
 * listener, and never observes a late task result.
 */
const awaitBounded = <T>(
  invoke: () => Promise<T>,
  nowMs: () => number,
  deadlineAtMs: number,
  signal: AbortSignal | undefined,
): Promise<BoundedOutcome<T>> =>
  new Promise((resolve) => {
    const pre = checkDeadline(nowMs, deadlineAtMs, signal)
    if (pre) {
      resolve({ kind: "stopped", status: pre })
      return
    }
    let settled = false
    const finish = (outcome: BoundedOutcome<T>): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (signal) {
        signal.removeEventListener("abort", onAbort)
      }
      resolve(outcome)
    }
    const remainingMs = Math.max(1, deadlineAtMs - nowMs())
    const timer = setTimeout(() => {
      finish({ kind: "stopped", status: "deadline" })
    }, remainingMs)
    const onAbort = (): void => {
      finish({ kind: "stopped", status: "cancelled" })
    }
    if (signal) {
      signal.addEventListener("abort", onAbort)
    }
    let task: Promise<T>
    try {
      task = invoke()
    } catch {
      finish({ kind: "thrown" })
      return
    }
    task.then(
      (value) => {
        finish({ kind: "settled", value })
      },
      () => {
        finish({ kind: "thrown" })
      },
    )
  })

const contextUnavailable = (
  reason: DialogMemoryContextUnavailableReason,
  counters: DialogMemoryCounters,
): DialogMemoryContextResult => ({
  kind: "context_unavailable",
  reason,
  counters: { ...counters },
})

const okResult = (
  summaryRecord: StoredDialogMemoryRecord | null,
  afterCoverageRaw: readonly DialogMemoryMessageDto[],
  scope: DialogMemoryScope,
  config: DialogMemoryConfig,
  token: DialogMemoryToken,
  completePrefix: boolean,
  counters: DialogMemoryCounters,
): DialogMemoryContextResult => ({
  kind: "ok",
  summaryRecord,
  afterCoverageRaw: [...afterCoverageRaw],
  scope: { ...scope },
  config: { ...config },
  token: { ...token },
  completePrefix,
  counters: { ...counters },
})

const measureOutput = (
  summaryRecord: StoredDialogMemoryRecord | null,
  afterCoverageRaw: readonly DialogMemoryMessageDto[],
  scope: DialogMemoryScope,
  config: DialogMemoryConfig,
  token: DialogMemoryToken,
  completePrefix: boolean,
  counters: DialogMemoryCounters,
): number => {
  const payload = {
    kind: "ok",
    summaryRecord: summaryRecord ? encodeStoredRecord(summaryRecord) : null,
    afterCoverageRaw,
    scope,
    config,
    token,
    completePrefix,
    counters,
  }
  return JSON.stringify(payload).length
}

const fitsOutput = (
  summaryRecord: StoredDialogMemoryRecord | null,
  afterCoverageRaw: readonly DialogMemoryMessageDto[],
  scope: DialogMemoryScope,
  config: DialogMemoryConfig,
  token: DialogMemoryToken,
  completePrefix: boolean,
  counters: DialogMemoryCounters,
  maxOutputEncodedChars: number,
): boolean => {
  try {
    return (
      measureOutput(
        summaryRecord,
        afterCoverageRaw,
        scope,
        config,
        token,
        completePrefix,
        counters,
      ) <= maxOutputEncodedChars
    )
  } catch {
    return false
  }
}

type ScanOutcome =
  | {
      kind: "ok"
      ascItems: DialogMemoryMessageDto[]
      memory: DialogMemoryDto
      perScanItems: number
      perScanBytes: number
    }
  | {
      kind: "unavailable"
      reason: DialogMemoryContextUnavailableReason
    }
  | {
      kind: "upstream"
      result: Exclude<DialogMemorySnapshotResult, { kind: "ok" }>
    }

/** Cache-relevant row metadata that must stay identical across all pages. */
const pageMetaOf = (memory: DialogMemoryDto): string =>
  JSON.stringify({
    workspaceId: memory.workspaceId,
    conversationId: memory.conversationId,
    memoryVersion: memory.memoryVersion,
    coveredSourceRevision: memory.coveredSourceRevision,
    topologyEpoch: memory.topologyEpoch,
    coverage: memory.coverage,
  })

const scanFullHistory = async (
  repository: DialogMemoryRepositoryPort,
  scope: DialogMemoryScope,
  token: DialogMemoryToken,
  pageSize: number,
  budgets: DialogMemoryBudgets,
  counters: DialogMemoryCounters,
  nowMs: () => number,
  deadlineAtMs: number,
  signal: AbortSignal | undefined,
): Promise<ScanOutcome> => {
  const descPages: DialogMemoryMessageDto[][] = []
  const seenRefs = new Set<string>()
  let currentCursor: DialogMemoryCursor | undefined
  let firstMemory: DialogMemoryDto | undefined
  let firstPageMeta: string | undefined
  let perScanItems = 0
  let perScanBytes = 0

  while (true) {
    const before = checkDeadline(nowMs, deadlineAtMs, signal)
    if (before) {
      return { kind: "unavailable", reason: before }
    }

    if (
      counters.pageFetches >= budgets.maxPageFetches ||
      perScanItems >= budgets.maxScanItems ||
      perScanBytes >= budgets.maxScanLogicalBytes
    ) {
      return { kind: "unavailable", reason: "insufficient_scan" }
    }

    const input =
      currentCursor === undefined
        ? { scope: { ...scope }, limit: pageSize, expectedToken: { ...token } }
        : {
            scope: { ...scope },
            limit: pageSize,
            cursor: currentCursor,
            expectedToken: { ...token },
          }

    // Every attempted fetch counts, including failed or cancelled attempts.
    counters.pageFetches++

    const outcome = await awaitBounded(
      () => repository.readSnapshot(input),
      nowMs,
      deadlineAtMs,
      signal,
    )
    if (outcome.kind === "stopped") {
      return { kind: "unavailable", reason: outcome.status }
    }
    if (outcome.kind === "thrown") {
      return { kind: "unavailable", reason: "unavailable" }
    }
    const result = outcome.value

    const after = checkDeadline(nowMs, deadlineAtMs, signal)
    if (after) {
      return { kind: "unavailable", reason: after }
    }

    if (result.kind !== "ok") {
      return { kind: "upstream", result }
    }

    if (!(sameScope(result.scope, scope) && sameToken(result.token, token))) {
      return { kind: "unavailable", reason: "unavailable" }
    }

    const memory = result.memory
    if (
      memory.workspaceId !== scope.workspaceId ||
      memory.conversationId !== scope.conversationId ||
      memory.memoryVersion !== token.memoryVersion
    ) {
      return { kind: "unavailable", reason: "unavailable" }
    }

    const pageMeta = pageMetaOf(memory)
    if (currentCursor === undefined) {
      firstMemory = structuredClone(memory)
      firstPageMeta = pageMeta
    } else if (pageMeta !== firstPageMeta) {
      return { kind: "unavailable", reason: "unavailable" }
    }

    if (!Array.isArray(result.items) || result.items.length > pageSize) {
      return { kind: "unavailable", reason: "unavailable" }
    }

    const items = result.items.map((item) => structuredClone(item))

    // Item/attachment scope and identity validation plus strict DESC ordering
    // and duplicate detection, failing closed before any further processing.
    try {
      for (const item of items) {
        if (
          item.workspaceId !== scope.workspaceId ||
          item.conversationId !== scope.conversationId
        ) {
          return { kind: "unavailable", reason: "unavailable" }
        }
        compareRefsAsc(item, item)
        if (!Array.isArray(item.attachments)) {
          return { kind: "unavailable", reason: "unavailable" }
        }
        for (const attachment of item.attachments) {
          if (
            attachment.workspaceId !== scope.workspaceId ||
            attachment.conversationId !== scope.conversationId ||
            attachment.messageId !== item.id ||
            attachment.messageCreatedAtMicros !== item.createdAtMicros
          ) {
            return { kind: "unavailable", reason: "unavailable" }
          }
          compareRefsAsc(attachment, attachment)
        }
      }
      for (let i = 1; i < items.length; i++) {
        if (compareRefsAsc(items[i - 1], items[i]) <= 0) {
          return { kind: "unavailable", reason: "unavailable" }
        }
      }
      const firstItem = items.at(0)
      const lastItem = items.at(-1)
      if (
        currentCursor !== undefined &&
        firstItem !== undefined &&
        compareRefsAsc(firstItem, currentCursor) >= 0
      ) {
        return { kind: "unavailable", reason: "unavailable" }
      }
      if (result.hasMore) {
        if (items.length === 0 || firstItem === undefined || !lastItem) {
          return { kind: "unavailable", reason: "unavailable" }
        }
        const next = result.nextCursor
        if (next === null) {
          return { kind: "unavailable", reason: "unavailable" }
        }
        compareRefsAsc(next, next)
        // The cursor must be exactly the last issued item of this page.
        if (
          next.id !== lastItem.id ||
          next.createdAtMicros !== lastItem.createdAtMicros
        ) {
          return { kind: "unavailable", reason: "unavailable" }
        }
        // Strict progress: next cursor strictly older than the previous one.
        if (
          currentCursor !== undefined &&
          compareRefsAsc(next, currentCursor) >= 0
        ) {
          return { kind: "unavailable", reason: "unavailable" }
        }
      } else if (result.nextCursor !== null) {
        return { kind: "unavailable", reason: "unavailable" }
      }
    } catch {
      return { kind: "unavailable", reason: "unavailable" }
    }

    for (const item of items) {
      const key = `${item.createdAtMicros}|${item.id}`
      if (seenRefs.has(key)) {
        return { kind: "unavailable", reason: "unavailable" }
      }
      seenRefs.add(key)
    }

    let pageBytes = 0
    try {
      pageBytes = utf8Bytes(JSON.stringify(items))
    } catch {
      return { kind: "unavailable", reason: "unavailable" }
    }

    // Hard per-scan caps are enforced before accepting the prospective page,
    // including the final one.
    if (
      perScanItems + items.length > budgets.maxScanItems ||
      perScanBytes + pageBytes > budgets.maxScanLogicalBytes
    ) {
      return { kind: "unavailable", reason: "insufficient_scan" }
    }

    descPages.push(items)
    perScanItems += items.length
    perScanBytes += pageBytes
    counters.scanItems += items.length
    counters.scanBytes += pageBytes

    if (!result.hasMore) {
      break
    }
    const next = result.nextCursor
    if (next === null) {
      return { kind: "unavailable", reason: "unavailable" }
    }
    currentCursor = { id: next.id, createdAtMicros: next.createdAtMicros }
  }

  // Reverse the WHOLE captured global sequence once after the scan completed;
  // items within pages stay in their validated order.
  const ascItems = descPages.flat().reverse()

  if (firstMemory === undefined) {
    return { kind: "unavailable", reason: "unavailable" }
  }

  return {
    kind: "ok",
    ascItems,
    memory: firstMemory,
    perScanItems,
    perScanBytes,
  }
}

type CacheClassification =
  | { kind: "trust_none" }
  | { kind: "trust_prefix"; record: StoredDialogMemoryRecord }

const classifyCache = (
  memory: DialogMemoryDto,
  token: DialogMemoryToken,
  scope: DialogMemoryScope,
  config: DialogMemoryConfig,
  validatorVersion: string,
): CacheClassification => {
  if (memory.summary === null || memory.summary === undefined) {
    return { kind: "trust_none" }
  }

  const decoded = decodeStoredRecord(memory.summary)
  if (decoded.kind !== "ok") {
    return { kind: "trust_none" }
  }

  const record = decoded.record

  if (
    record.storageVersion !== STORAGE_VERSION ||
    record.manifestVersion !== MANIFEST_VERSION
  ) {
    return { kind: "trust_none" }
  }
  if (record.validatorVersion !== validatorVersion) {
    return { kind: "trust_none" }
  }
  if (!sameScope(record.scope, scope)) {
    return { kind: "trust_none" }
  }
  // Both the DB row config and the stored record config must match the
  // request config; a mismatch means rebuild, never a global rejection.
  if (!(sameConfig(record.config, config) && sameConfig(memory, config))) {
    return { kind: "trust_none" }
  }
  if (memory.topologyEpoch !== token.topologyEpoch) {
    return { kind: "trust_none" }
  }
  try {
    if (BigInt(memory.coveredSourceRevision) > BigInt(token.sourceRevision)) {
      return { kind: "trust_none" }
    }
  } catch {
    return { kind: "trust_none" }
  }
  if (!sameRef(record.coverage, memory.coverage)) {
    return { kind: "trust_none" }
  }

  const expectedCoverage = coverageRefOf(record.coveredManifest)
  if (!sameRef(expectedCoverage, record.coverage)) {
    return { kind: "trust_none" }
  }

  return { kind: "trust_prefix", record }
}

type BatchSelection = {
  batch: DialogMemoryMessageDto[]
  remaining: DialogMemoryMessageDto[]
}

const selectBatch = (
  uncovered: readonly DialogMemoryMessageDto[],
  maxBatchItems: number,
  maxBatchEncodedChars: number,
): BatchSelection => {
  const batch: DialogMemoryMessageDto[] = []
  let batchChars = 0

  for (const item of uncovered) {
    const itemChars = JSON.stringify(item).length
    if (batch.length === 0) {
      if (itemChars > maxBatchEncodedChars) {
        return { batch: [], remaining: [...uncovered] }
      }
      batch.push(structuredClone(item))
      batchChars += itemChars
      continue
    }
    if (
      batch.length >= maxBatchItems ||
      batchChars + itemChars > maxBatchEncodedChars
    ) {
      break
    }
    batch.push(structuredClone(item))
    batchChars += itemChars
  }

  return { batch, remaining: uncovered.slice(batch.length) }
}

/**
 * Conservative pre-LLM estimate of the stored record size in UTF-8 bytes
 * (envelope plus manifest, plus a payload estimate). The authoritative check
 * re-measures the actual encoded record before publish.
 */
const estimateStoredRecordBytes = (
  validatorVersion: string,
  scope: DialogMemoryScope,
  config: DialogMemoryConfig,
  manifest: readonly FingerprintedRef[],
  payloadEstimateBytes: number,
): number => {
  const record: StoredDialogMemoryRecord = {
    storageVersion: 1,
    manifestVersion: 1,
    validatorVersion,
    scope,
    config,
    coverage: coverageRefOf(manifest),
    coveredManifest: [...manifest],
    payload: null,
  }
  const encoded = encodeStoredRecord(record)
  return utf8Bytes(JSON.stringify(encoded)) + payloadEstimateBytes
}

export const createDialogMemoryService = (deps: {
  repository: DialogMemoryRepositoryPort
  summarizer: SummarizerPort
  validator: SemanticValidatorPort
  config: DialogMemoryServiceConfig
}): DialogMemoryService => {
  const validatorVersion = deps.config.validatorVersion
  if (typeof validatorVersion !== "string" || validatorVersion.length === 0) {
    throw new Error(
      "dialog-memory: validatorVersion must be a non-empty string",
    )
  }

  // Validate and detach the canonical scope/config before any IO by decoding
  // a minimal empty record through the coverage validators.
  const probe = decodeStoredRecord({
    storageVersion: 1,
    manifestVersion: 1,
    validatorVersion,
    scope: deps.config.scope,
    config: deps.config.config,
    coverage: null,
    coveredManifest: [],
    payload: null,
  })
  if (probe.kind !== "ok") {
    throw new Error("dialog-memory: service scope/config failed validation")
  }
  const scope = probe.record.scope
  const config = probe.record.config

  const budgets = validateBudgets(deps.config.budgets)

  const repository = deps.repository
  const summarizer = deps.summarizer
  const validator = deps.validator
  if (
    typeof repository !== "object" ||
    repository === null ||
    typeof repository.register !== "function" ||
    typeof repository.readSnapshot !== "function" ||
    typeof repository.publishIfUnchanged !== "function" ||
    typeof repository.resetDerived !== "function" ||
    typeof summarizer !== "object" ||
    summarizer === null ||
    typeof summarizer.summarize !== "function" ||
    typeof validator !== "object" ||
    validator === null ||
    typeof validator.validate !== "function"
  ) {
    throw new Error("dialog-memory: all injected ports must be callable")
  }

  const nowMs = deps.config.nowMs ?? Date.now
  if (typeof nowMs !== "function") {
    throw new Error("dialog-memory: nowMs clock must be callable")
  }
  const deadlineAtMs = deps.config.deadlineAtMs
  if (!Number.isSafeInteger(deadlineAtMs)) {
    throw new Error(
      "dialog-memory: deadlineAtMs must be a safe finite absolute timestamp",
    )
  }

  const service: DialogMemoryService = {
    async getTrustedContext(input) {
      const signal = input?.signal
      const counters: DialogMemoryCounters = {
        pageFetches: 0,
        scanItems: 0,
        scanBytes: 0,
        llmCalls: 0,
        cycles: 0,
      }

      try {
        while (true) {
          const cycleStart = checkDeadline(nowMs, deadlineAtMs, signal)
          if (cycleStart) {
            return contextUnavailable(cycleStart, counters)
          }

          if (counters.cycles >= budgets.maxCycles) {
            return contextUnavailable("stale_conflict", counters)
          }
          counters.cycles++

          const registerOutcome = await awaitBounded(
            () =>
              repository.register({
                scope: { ...scope },
                config: { ...config },
              }),
            nowMs,
            deadlineAtMs,
            signal,
          )
          if (registerOutcome.kind === "stopped") {
            return contextUnavailable(registerOutcome.status, counters)
          }
          if (registerOutcome.kind === "thrown") {
            return contextUnavailable("unavailable", counters)
          }
          const registerResult = registerOutcome.value
          if (registerResult.kind !== "ok") {
            return registerResult
          }
          const token = registerResult.token

          const scanResult = await scanFullHistory(
            repository,
            scope,
            token,
            budgets.pageSize,
            budgets,
            counters,
            nowMs,
            deadlineAtMs,
            signal,
          )

          if (scanResult.kind === "upstream") {
            if (scanResult.result.kind === "conflict") {
              continue
            }
            return scanResult.result
          }
          if (scanResult.kind !== "ok") {
            return contextUnavailable(scanResult.reason, counters)
          }

          const { ascItems, memory } = scanResult

          const classification = classifyCache(
            memory,
            token,
            scope,
            config,
            validatorVersion,
          )

          let priorRecord: StoredDialogMemoryRecord | null = null
          let coveredCount = 0
          let mode: "rebuild" | "append" = "rebuild"
          let priorPayload: unknown | null = null

          if (classification.kind === "trust_prefix") {
            const diff = diffManifest(
              classification.record.coveredManifest,
              ascItems,
            )
            if (diff.kind === "append") {
              priorRecord = classification.record
              coveredCount = diff.coveredCount
              mode = "append"
              priorPayload = classification.record.payload
            }
          }

          const uncovered = ascItems.slice(coveredCount)

          // Lazy path: return immediately if the whole context fits the
          // output budget; no summarizer, validator, or publish involved.
          const priorComplete =
            priorRecord !== null &&
            isFullCoverage(priorRecord.coveredManifest, ascItems)
          if (
            fitsOutput(
              priorRecord,
              uncovered,
              scope,
              config,
              token,
              priorComplete,
              counters,
              budgets.maxOutputEncodedChars,
            )
          ) {
            return okResult(
              priorRecord,
              uncovered,
              scope,
              config,
              token,
              priorComplete,
              counters,
            )
          }

          if (uncovered.length === 0) {
            return contextUnavailable("oversize", counters)
          }

          const { batch } = selectBatch(
            uncovered,
            budgets.maxBatchItems,
            budgets.maxBatchEncodedChars,
          )

          if (batch.length === 0) {
            // Single uncovered item exceeds the batch budget.
            if (
              fitsOutput(
                null,
                ascItems,
                scope,
                config,
                token,
                false,
                counters,
                budgets.maxOutputEncodedChars,
              )
            ) {
              return okResult(
                null,
                ascItems,
                scope,
                config,
                token,
                false,
                counters,
              )
            }
            return contextUnavailable("oversize", counters)
          }

          if (counters.llmCalls >= budgets.maxLlmCalls) {
            return contextUnavailable("llm_unavailable", counters)
          }
          counters.llmCalls++

          const candidatePrefix = ascItems.slice(0, coveredCount + batch.length)
          let candidateManifest: FingerprintedRef[]
          try {
            candidateManifest = buildManifest(candidatePrefix)
          } catch {
            return contextUnavailable("unavailable", counters)
          }

          let beforeEstimate: number
          try {
            beforeEstimate = estimateStoredRecordBytes(
              validatorVersion,
              scope,
              config,
              candidateManifest,
              budgets.maxBatchEncodedChars,
            )
          } catch {
            return contextUnavailable("unavailable", counters)
          }
          if (beforeEstimate > budgets.maxStoredJsonBytes) {
            return contextUnavailable("oversize", counters)
          }

          // The prior payload is a live reference into the private cached
          // record; hand the port a detached copy so an accidental mutation
          // can never poison the unvalidated fallback summary.
          const summarizeOutcome = await awaitBounded(
            () =>
              summarizer.summarize({
                mode,
                priorPayload: structuredClone(priorPayload),
                batch: batch.map((item) => structuredClone(item)),
                evidence: candidatePrefix.map((item) => structuredClone(item)),
                budget: { maxEncodedChars: budgets.maxBatchEncodedChars },
                deadlineAtMs,
                signal,
              }),
            nowMs,
            deadlineAtMs,
            signal,
          )
          if (summarizeOutcome.kind === "stopped") {
            return contextUnavailable(summarizeOutcome.status, counters)
          }
          const summarizeResult: Awaited<
            ReturnType<SummarizerPort["summarize"]>
          > =
            summarizeOutcome.kind === "thrown"
              ? { kind: "unavailable", reason: "unavailable" }
              : summarizeOutcome.value

          const afterSummarize = checkDeadline(nowMs, deadlineAtMs, signal)
          if (afterSummarize) {
            return contextUnavailable(afterSummarize, counters)
          }

          if (summarizeResult.kind !== "ok") {
            if (mode === "rebuild") {
              if (
                fitsOutput(
                  null,
                  ascItems,
                  scope,
                  config,
                  token,
                  false,
                  counters,
                  budgets.maxOutputEncodedChars,
                )
              ) {
                return okResult(
                  null,
                  ascItems,
                  scope,
                  config,
                  token,
                  false,
                  counters,
                )
              }
            } else if (
              fitsOutput(
                priorRecord,
                ascItems.slice(coveredCount),
                scope,
                config,
                token,
                false,
                counters,
                budgets.maxOutputEncodedChars,
              )
            ) {
              return okResult(
                priorRecord,
                ascItems.slice(coveredCount),
                scope,
                config,
                token,
                false,
                counters,
              )
            }
            return contextUnavailable("llm_unavailable", counters)
          }

          // Detach the candidate before handing it over so the validator
          // never keeps a live reference into summarizer-owned state. The
          // flat string/number scope and config DTOs are copied too, so an
          // adversarial validator mutating (or retaining and later mutating)
          // its input metadata can never rebind the server-private scope and
          // config used for publish and for the delivered output.
          const validateOutcome = await awaitBounded(
            () =>
              validator.validate({
                candidatePayload: structuredClone(summarizeResult.payload),
                sourceEvidence: candidatePrefix.map((item) =>
                  structuredClone(item),
                ),
                scope: { ...scope },
                config: { ...config },
                deadlineAtMs,
                signal,
              }),
            nowMs,
            deadlineAtMs,
            signal,
          )
          if (validateOutcome.kind === "stopped") {
            return contextUnavailable(validateOutcome.status, counters)
          }
          const validatorResult: Awaited<
            ReturnType<SemanticValidatorPort["validate"]>
          > =
            validateOutcome.kind === "thrown"
              ? { kind: "reject", reason: "unavailable" }
              : validateOutcome.value

          const afterValidate = checkDeadline(nowMs, deadlineAtMs, signal)
          if (afterValidate) {
            return contextUnavailable(afterValidate, counters)
          }

          if (validatorResult.kind !== "accept") {
            return contextUnavailable("validator_reject", counters)
          }

          // The candidate is bound to the server manifest and coverage only
          // after semantic accept.
          const storedRecord: StoredDialogMemoryRecord = {
            storageVersion: 1,
            manifestVersion: 1,
            validatorVersion,
            scope,
            config,
            coverage: coverageRefOf(candidateManifest),
            coveredManifest: [...candidateManifest],
            payload: validatorResult.payload,
          }

          let encoded: unknown
          try {
            encoded = encodeStoredRecord(storedRecord)
          } catch {
            return contextUnavailable("oversize", counters)
          }

          // Detach the accepted record BEFORE the publish await: only this
          // pre-await decode may be measured and delivered, so a port that
          // mutates its validator-owned payload object while the repository
          // call is pending can never change the delivered summary. A decode
          // after the await would capture the poisoned state instead.
          const accepted = decodeStoredRecord(encoded)
          if (accepted.kind !== "ok") {
            // Constant sanitized reason; never expose the decode detail.
            return contextUnavailable("unavailable", counters)
          }
          const acceptedRecord = accepted.record

          let storedBytes: number
          try {
            storedBytes = utf8Bytes(JSON.stringify(encoded))
          } catch {
            return contextUnavailable("oversize", counters)
          }
          if (storedBytes > budgets.maxStoredJsonBytes) {
            return contextUnavailable("oversize", counters)
          }

          // Hand the port a copy so repository-side mutation cannot alter the
          // encoded record kept for delivery.
          const publishOutcome = await awaitBounded(
            () =>
              repository.publishIfUnchanged({
                scope: { ...scope },
                expectedToken: { ...token },
                summary: structuredClone(encoded),
                coverage: coverageRefOf(candidateManifest),
                config: { ...config },
              }),
            nowMs,
            deadlineAtMs,
            signal,
          )
          if (publishOutcome.kind === "stopped") {
            return contextUnavailable(publishOutcome.status, counters)
          }
          if (publishOutcome.kind === "thrown") {
            return contextUnavailable("unavailable", counters)
          }
          const publishResult = publishOutcome.value

          const afterPublish = checkDeadline(nowMs, deadlineAtMs, signal)
          if (afterPublish) {
            return contextUnavailable(afterPublish, counters)
          }

          if (publishResult.kind === "conflict") {
            continue
          }
          if (publishResult.kind !== "ok") {
            return publishResult
          }

          const newToken = publishResult.token
          const remainingRaw = ascItems.slice(coveredCount + batch.length)
          const completePrefix = isFullCoverage(candidateManifest, ascItems)

          if (
            fitsOutput(
              acceptedRecord,
              remainingRaw,
              scope,
              config,
              newToken,
              completePrefix,
              counters,
              budgets.maxOutputEncodedChars,
            )
          ) {
            return okResult(
              acceptedRecord,
              remainingRaw,
              scope,
              config,
              newToken,
              completePrefix,
              counters,
            )
          }

          // Output still does not fit: continue with a fresh cycle.
        }
      } catch {
        // Any unexpected internal error (type, hash, BigInt, encoding) fails
        // closed with a constant reason, never an unhandled rejection.
        return contextUnavailable("unavailable", counters)
      }
    },

    reset(input) {
      return repository.resetDerived({
        scope: { ...scope },
        expectedToken: { ...input.expectedToken },
      })
    },
  }

  return service
}
