import { isProxy } from "node:util/types"
import {
  assessCallBudget,
  type BudgetPlan,
} from "./lib/eval-dialog-memory-call-budget"
import { loadDialogMemoryDatasetBytes } from "./lib/eval-dialog-memory-dataset-bytes"

export const RUNNER_VERSION = "t08-runner-v1" as const
export const LIVE_EXECUTION_AUTHORIZED = false as const

export type RunnerRequest = {
  readonly dataset: Uint8Array
  readonly stage: "a1" | "b"
  readonly retries: number
  readonly calls: readonly { readonly model: string; readonly count: number }[]
  readonly dryRun: boolean
}

export type RunnerRefusal =
  | { readonly kind: "refused"; readonly code: "invalid_request" }
  | { readonly kind: "refused"; readonly code: "live_run_forbidden" }
  | {
      readonly kind: "refused"
      readonly code: "dataset_rejected"
      readonly datasetCode: string
    }
  | {
      readonly kind: "refused"
      readonly code: "invalid_plan" | "retries_forbidden" | "budget_exceeded"
    }
  | {
      readonly kind: "refused"
      readonly code: "execution_not_authorized"
      readonly caseCount: 30
      readonly datasetSha256: string
      readonly callLimits: {
        readonly candidate: number
        readonly judge: number
      }
      readonly perModel: readonly {
        readonly model: string
        readonly count: number
      }[]
    }

const REQUEST_KEYS = ["calls", "dataset", "dryRun", "retries", "stage"] as const

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false
  }
  if (isProxy(value) || Array.isArray(value)) {
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

const invalidRequest = (): RunnerRefusal => ({
  kind: "refused",
  code: "invalid_request",
})

const liveRunForbidden = (): RunnerRefusal => ({
  kind: "refused",
  code: "live_run_forbidden",
})

const datasetRejected = (datasetCode: string): RunnerRefusal => ({
  kind: "refused",
  code: "dataset_rejected",
  datasetCode,
})

const safeIsProxy = (value: unknown): boolean => {
  try {
    return isProxy(value)
  } catch {
    return true
  }
}

export const planDialogMemoryRun = (request: RunnerRequest): RunnerRefusal => {
  if (safeIsProxy(request) || !isPlainObject(request)) {
    return invalidRequest()
  }
  const ownNames = Object.getOwnPropertyNames(request)
  if (
    Object.getOwnPropertySymbols(request).length > 0 ||
    ownNames.length !== REQUEST_KEYS.length ||
    REQUEST_KEYS.some((key) => !ownNames.includes(key))
  ) {
    return invalidRequest()
  }

  const dryRunField = readOwnData(request, "dryRun")
  if (dryRunField.kind !== "value" || typeof dryRunField.value !== "boolean") {
    return invalidRequest()
  }
  if (!dryRunField.value) {
    return liveRunForbidden()
  }

  const datasetField = readOwnData(request, "dataset")
  if (datasetField.kind !== "value" || safeIsProxy(datasetField.value)) {
    return invalidRequest()
  }
  if (!(datasetField.value instanceof Uint8Array)) {
    return invalidRequest()
  }

  const loaded = loadDialogMemoryDatasetBytes(datasetField.value)
  if (loaded.kind === "invalid") {
    return datasetRejected(loaded.code)
  }
  if (loaded.preflight.kind !== "valid") {
    return datasetRejected(loaded.preflight.code)
  }

  const stageField = readOwnData(request, "stage")
  const retriesField = readOwnData(request, "retries")
  const callsField = readOwnData(request, "calls")
  if (
    stageField.kind !== "value" ||
    retriesField.kind !== "value" ||
    callsField.kind !== "value"
  ) {
    return invalidRequest()
  }

  const assessment = assessCallBudget({
    stage: stageField.value,
    retries: retriesField.value,
    calls: callsField.value,
  } as BudgetPlan)
  if (assessment.code !== "execution_not_authorized") {
    return { kind: "refused", code: assessment.code }
  }
  return {
    kind: "refused",
    code: "execution_not_authorized",
    caseCount: loaded.preflight.caseCount,
    datasetSha256: loaded.datasetSha256,
    callLimits: assessment.callLimits,
    perModel: assessment.perModel,
  }
}
