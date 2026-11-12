/**
 * Dialog memory service ports, budgets, and result types.
 *
 * This module declares only the injected port shapes and public result unions.
 * No IO, no runtime database imports, no activation wiring. T07 (semantic
 * validator) and T09 (summarizer) are mandatory injected ports; the service
 * will not fall back to a default validator or always-accept generator.
 *
 * Budget defaults are conservative guard rails for the amount of work a single
 * request may consume. They are NOT a guarantee that an arbitrary history
 * will fit into the output budget.
 */

import type {
  DialogMemoryConfig,
  DialogMemoryMessageDto,
  DialogMemoryPublishInput,
  DialogMemoryPublishResult,
  DialogMemoryRegisterResult,
  DialogMemoryResetInput,
  DialogMemoryResetResult,
  DialogMemoryScope,
  DialogMemorySnapshotInput,
  DialogMemorySnapshotResult,
  DialogMemoryToken,
} from "@chatbotx.io/database/repositories"
import type { StoredDialogMemoryRecord } from "./memory-coverage"

export type DialogMemoryRepositoryPort = {
  register(input: {
    scope: DialogMemoryScope
    config: DialogMemoryConfig
  }): Promise<DialogMemoryRegisterResult>
  readSnapshot(
    input: DialogMemorySnapshotInput,
  ): Promise<DialogMemorySnapshotResult>
  publishIfUnchanged(
    input: DialogMemoryPublishInput,
  ): Promise<DialogMemoryPublishResult>
  resetDerived(input: DialogMemoryResetInput): Promise<DialogMemoryResetResult>
}

export type SummarizerPort = {
  summarize(input: {
    mode: "rebuild" | "append"
    priorPayload: unknown | null
    batch: readonly DialogMemoryMessageDto[]
    evidence: readonly DialogMemoryMessageDto[]
    budget: { maxEncodedChars: number }
    deadlineAtMs: number
    signal?: AbortSignal
  }): Promise<
    { kind: "ok"; payload: unknown } | { kind: "unavailable"; reason: string }
  >
}

export type SemanticValidatorPort = {
  validate(input: {
    candidatePayload: unknown
    sourceEvidence: readonly DialogMemoryMessageDto[]
    scope: DialogMemoryScope
    config: DialogMemoryConfig
    deadlineAtMs: number
    signal?: AbortSignal
  }): Promise<
    { kind: "accept"; payload: unknown } | { kind: "reject"; reason: string }
  >
}

export type DialogMemoryBudgets = {
  maxPageFetches: number
  pageSize: number
  maxScanItems: number
  maxScanLogicalBytes: number
  maxLlmCalls: number
  maxCycles: number
  maxBatchItems: number
  maxBatchEncodedChars: number
  maxOutputEncodedChars: number
  maxStoredJsonBytes: number
}

export type DialogMemoryServiceConfig = {
  scope: DialogMemoryScope
  config: DialogMemoryConfig
  validatorVersion: string
  budgets?: Partial<DialogMemoryBudgets>
  nowMs?: () => number
  deadlineAtMs: number
}

export type DialogMemoryCounters = {
  pageFetches: number
  scanItems: number
  scanBytes: number
  llmCalls: number
  cycles: number
}

export type DialogMemoryContextUnavailableReason =
  | "insufficient_scan"
  | "oversize"
  | "llm_unavailable"
  | "validator_reject"
  | "stale_conflict"
  | "budget_exhausted"
  | "deadline"
  | "cancelled"
  | "unavailable"

export type DialogMemoryContextOkResult = {
  kind: "ok"
  summaryRecord: StoredDialogMemoryRecord | null
  afterCoverageRaw: readonly DialogMemoryMessageDto[]
  scope: DialogMemoryScope
  config: DialogMemoryConfig
  token: DialogMemoryToken
  completePrefix: boolean
  counters: DialogMemoryCounters
}

export type DialogMemoryContextUnavailableResult = {
  kind: "context_unavailable"
  reason: DialogMemoryContextUnavailableReason
  counters: DialogMemoryCounters
}

export type DialogMemoryContextResult =
  | DialogMemoryContextOkResult
  | DialogMemoryContextUnavailableResult
  | Exclude<DialogMemoryRegisterResult, { kind: "ok" } | { kind: "conflict" }>
  | Exclude<DialogMemorySnapshotResult, { kind: "ok" } | { kind: "conflict" }>
  | Exclude<DialogMemoryPublishResult, { kind: "ok" } | { kind: "conflict" }>

export type DialogMemoryService = {
  getTrustedContext(input?: {
    signal?: AbortSignal
  }): Promise<DialogMemoryContextResult>
  reset(input: {
    expectedToken: DialogMemoryToken
  }): Promise<DialogMemoryResetResult>
}
