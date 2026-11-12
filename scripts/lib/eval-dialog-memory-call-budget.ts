import { isProxy } from "node:util/types"
import {
  CANDIDATE_MODELS,
  HTTP_CALL_LIMIT_MAX,
  JUDGE_MODEL_NAME,
} from "./eval-dialog-memory-http"

export const CALL_BUDGET_VERSION = "t08-call-budget-v1" as const
export const A1_MAX_JUDGE_CALLS = 16 as const
export const B_CALLS_PER_CANDIDATE = 1 as const
export const RETRY_LIMIT = 0 as const
export const EXECUTION_AUTHORIZED = false as const

export type BudgetCall = {
  readonly model: string
  readonly count: number
}

export type BudgetPlan = {
  readonly stage: "a1" | "b"
  readonly retries: number
  readonly calls: readonly BudgetCall[]
}

export type BudgetFailureCode =
  | "invalid_plan"
  | "retries_forbidden"
  | "budget_exceeded"
  | "execution_not_authorized"

export type BudgetAssessment =
  | {
      readonly kind: "refused"
      readonly code: "invalid_plan" | "retries_forbidden" | "budget_exceeded"
    }
  | {
      readonly kind: "refused"
      readonly code: "execution_not_authorized"
      readonly callLimits: {
        readonly candidate: number
        readonly judge: number
      }
      readonly perModel: readonly {
        readonly model: string
        readonly count: number
      }[]
    }

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

const invalidPlan = (): BudgetAssessment => ({
  kind: "refused",
  code: "invalid_plan",
})

const retriesForbidden = (): BudgetAssessment => ({
  kind: "refused",
  code: "retries_forbidden",
})

const budgetExceeded = (): BudgetAssessment => ({
  kind: "refused",
  code: "budget_exceeded",
})

const executionNotAuthorized = (
  callLimits: { readonly candidate: number; readonly judge: number },
  perModel: readonly { readonly model: string; readonly count: number }[],
): BudgetAssessment => ({
  kind: "refused",
  code: "execution_not_authorized",
  callLimits,
  perModel,
})

export const assessCallBudget = (plan: BudgetPlan): BudgetAssessment => {
  if (isProxy(plan) || !isPlainObject(plan)) {
    return invalidPlan()
  }

  const ownNames = Object.getOwnPropertyNames(plan)
  const ownSymbols = Object.getOwnPropertySymbols(plan)
  if (
    ownSymbols.length > 0 ||
    ownNames.length !== 3 ||
    !ownNames.includes("stage") ||
    !ownNames.includes("retries") ||
    !ownNames.includes("calls")
  ) {
    return invalidPlan()
  }

  const stageField = readOwnData(plan, "stage")
  const retriesField = readOwnData(plan, "retries")
  const callsField = readOwnData(plan, "calls")
  if (
    stageField.kind !== "value" ||
    retriesField.kind !== "value" ||
    callsField.kind !== "value"
  ) {
    return invalidPlan()
  }

  const stage = stageField.value
  if (stage !== "a1" && stage !== "b") {
    return invalidPlan()
  }

  const retries = retriesField.value
  if (
    typeof retries !== "number" ||
    !Number.isSafeInteger(retries) ||
    retries < 0
  ) {
    return invalidPlan()
  }

  const calls = callsField.value
  if (isProxy(calls)) {
    return invalidPlan()
  }
  if (
    !Array.isArray(calls) ||
    Object.getPrototypeOf(calls) !== Array.prototype
  ) {
    return invalidPlan()
  }

  const lengthField = Object.getOwnPropertyDescriptor(calls, "length")
  if (
    lengthField === undefined ||
    !("value" in lengthField) ||
    typeof lengthField.value !== "number" ||
    !Number.isSafeInteger(lengthField.value) ||
    lengthField.value < 1
  ) {
    return invalidPlan()
  }
  const length = lengthField.value

  const callNames = Object.getOwnPropertyNames(calls)
  const callSymbols = Object.getOwnPropertySymbols(calls)
  if (callSymbols.length > 0) {
    return invalidPlan()
  }

  const indexSet = new Set<string>()
  for (const name of callNames) {
    if (name === "length") {
      continue
    }
    indexSet.add(name)
  }
  if (indexSet.size !== length) {
    return invalidPlan()
  }
  for (let index = 0; index < length; index++) {
    if (!indexSet.has(String(index))) {
      return invalidPlan()
    }
  }

  const validatedRows: object[] = []
  for (let index = 0; index < length; index++) {
    const rowField = readOwnData(calls, String(index))
    if (rowField.kind !== "value") {
      return invalidPlan()
    }
    const row = rowField.value
    if (isProxy(row) || !isPlainObject(row)) {
      return invalidPlan()
    }

    const rowNames = Object.getOwnPropertyNames(row)
    const rowSymbols = Object.getOwnPropertySymbols(row)
    if (
      rowSymbols.length > 0 ||
      rowNames.length !== 2 ||
      !rowNames.includes("model") ||
      !rowNames.includes("count")
    ) {
      return invalidPlan()
    }

    const modelField = readOwnData(row, "model")
    const countField = readOwnData(row, "count")
    if (modelField.kind !== "value" || countField.kind !== "value") {
      return invalidPlan()
    }

    const model = modelField.value
    const count = countField.value
    if (typeof model !== "string") {
      return invalidPlan()
    }
    if (
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 1
    ) {
      return invalidPlan()
    }

    validatedRows.push(row as object)
  }

  if (retries !== 0) {
    return retriesForbidden()
  }

  if (stage === "a1") {
    if (validatedRows.length !== 1) {
      return budgetExceeded()
    }

    const firstRow = validatedRows[0]
    const modelField = readOwnData(firstRow, "model")
    const countField = readOwnData(firstRow, "count")
    if (modelField.kind !== "value" || countField.kind !== "value") {
      return budgetExceeded()
    }

    const model = modelField.value
    const count = countField.value
    if (
      model !== JUDGE_MODEL_NAME ||
      typeof count !== "number" ||
      count > A1_MAX_JUDGE_CALLS ||
      count > HTTP_CALL_LIMIT_MAX
    ) {
      return budgetExceeded()
    }

    return executionNotAuthorized({ candidate: 0, judge: count }, [
      { model: JUDGE_MODEL_NAME, count },
    ])
  }

  const matched = new Set<number>()
  for (const candidate of CANDIDATE_MODELS) {
    const found = validatedRows.findIndex((row) => {
      const modelField = readOwnData(row, "model")
      const countField = readOwnData(row, "count")
      return (
        modelField.kind === "value" &&
        countField.kind === "value" &&
        modelField.value === candidate &&
        countField.value === B_CALLS_PER_CANDIDATE
      )
    })
    if (found === -1 || matched.has(found)) {
      return budgetExceeded()
    }
    matched.add(found)
  }

  if (
    matched.size !== validatedRows.length ||
    CANDIDATE_MODELS.length > HTTP_CALL_LIMIT_MAX
  ) {
    return budgetExceeded()
  }

  return executionNotAuthorized(
    { candidate: CANDIDATE_MODELS.length, judge: 0 },
    CANDIDATE_MODELS.map((model) => ({ model, count: B_CALLS_PER_CANDIDATE })),
  )
}
