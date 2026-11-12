import { describe, expect, test, vi } from "vitest"
import {
  A1_MAX_JUDGE_CALLS,
  assessCallBudget,
  B_CALLS_PER_CANDIDATE,
  type BudgetAssessment,
  CALL_BUDGET_VERSION,
  EXECUTION_AUTHORIZED,
  RETRY_LIMIT,
} from "../../../../scripts/lib/eval-dialog-memory-call-budget"
import {
  CANDIDATE_MODELS,
  HTTP_CALL_LIMIT_MAX,
  JUDGE_MODEL_NAME,
} from "../../../../scripts/lib/eval-dialog-memory-http"

const SENTINEL_MODEL_NAME = "sentinel-model-name"

type Plan = Parameters<typeof assessCallBudget>[0]

const acceptedLimits = (result: BudgetAssessment) => {
  if (result.code !== "execution_not_authorized") {
    throw new Error("missing limits")
  }
  return result.callLimits
}

describe("eval-dialog-memory-call-budget", () => {
  test("runtime exports", () => {
    expect(CALL_BUDGET_VERSION).toBe("t08-call-budget-v1")
    expect(A1_MAX_JUDGE_CALLS).toBe(16)
    expect(B_CALLS_PER_CANDIDATE).toBe(1)
    expect(RETRY_LIMIT).toBe(0)
    expect(EXECUTION_AUTHORIZED).toBe(false)
    expect(typeof assessCallBudget).toBe("function")
  })

  test("A1 with 16 judge calls is execution_not_authorized", () => {
    const result = assessCallBudget({
      stage: "a1",
      retries: 0,
      calls: [{ model: JUDGE_MODEL_NAME, count: 16 }],
    })
    expect(result).toEqual({
      kind: "refused",
      code: "execution_not_authorized",
      callLimits: { candidate: 0, judge: 16 },
      perModel: [{ model: JUDGE_MODEL_NAME, count: 16 }],
    })
    const limits = acceptedLimits(result)
    expect(limits.candidate).toBeLessThanOrEqual(HTTP_CALL_LIMIT_MAX)
    expect(limits.judge).toBeLessThanOrEqual(HTTP_CALL_LIMIT_MAX)
  })

  test("A1 with 1 judge call is execution_not_authorized", () => {
    const result = assessCallBudget({
      stage: "a1",
      retries: 0,
      calls: [{ model: JUDGE_MODEL_NAME, count: 1 }],
    })
    expect(result).toEqual({
      kind: "refused",
      code: "execution_not_authorized",
      callLimits: { candidate: 0, judge: 1 },
      perModel: [{ model: JUDGE_MODEL_NAME, count: 1 }],
    })
    const limits = acceptedLimits(result)
    expect(limits.candidate).toBeLessThanOrEqual(HTTP_CALL_LIMIT_MAX)
    expect(limits.judge).toBeLessThanOrEqual(HTTP_CALL_LIMIT_MAX)
  })

  test("A1 with 17 judge calls is budget_exceeded", () => {
    const result = assessCallBudget({
      stage: "a1",
      retries: 0,
      calls: [{ model: JUDGE_MODEL_NAME, count: 17 }],
    })
    expect(result).toEqual({ kind: "refused", code: "budget_exceeded" })
  })

  test("A1 with a candidate model is budget_exceeded without echoing it", () => {
    const result = assessCallBudget({
      stage: "a1",
      retries: 0,
      calls: [{ model: CANDIDATE_MODELS[0], count: 1 }],
    })
    expect(result).toEqual({ kind: "refused", code: "budget_exceeded" })
    expect(JSON.stringify(result)).not.toContain(CANDIDATE_MODELS[0])
  })

  test("A1 with two judge rows is budget_exceeded", () => {
    const result = assessCallBudget({
      stage: "a1",
      retries: 0,
      calls: [
        { model: JUDGE_MODEL_NAME, count: 1 },
        { model: JUDGE_MODEL_NAME, count: 1 },
      ],
    })
    expect(result).toEqual({ kind: "refused", code: "budget_exceeded" })
  })

  test("B in reversed model order is execution_not_authorized in constant order", () => {
    const calls = [...CANDIDATE_MODELS]
      .reverse()
      .map((model) => ({ model, count: 1 as const }))
    const result = assessCallBudget({
      stage: "b",
      retries: 0,
      calls,
    })
    expect(result).toEqual({
      kind: "refused",
      code: "execution_not_authorized",
      callLimits: { candidate: CANDIDATE_MODELS.length, judge: 0 },
      perModel: CANDIDATE_MODELS.map((model) => ({ model, count: 1 })),
    })
    const limits = acceptedLimits(result)
    expect(limits.candidate).toBeLessThanOrEqual(HTTP_CALL_LIMIT_MAX)
    expect(limits.judge).toBeLessThanOrEqual(HTTP_CALL_LIMIT_MAX)
  })

  test("B with the first model counted twice is budget_exceeded", () => {
    const result = assessCallBudget({
      stage: "b",
      retries: 0,
      calls: [
        { model: CANDIDATE_MODELS[0], count: 2 },
        { model: CANDIDATE_MODELS[1], count: 1 },
        { model: CANDIDATE_MODELS[2], count: 1 },
      ],
    })
    expect(result).toEqual({ kind: "refused", code: "budget_exceeded" })
  })

  test("B with only the first two models is budget_exceeded", () => {
    const result = assessCallBudget({
      stage: "b",
      retries: 0,
      calls: [
        { model: CANDIDATE_MODELS[0], count: 1 },
        { model: CANDIDATE_MODELS[1], count: 1 },
      ],
    })
    expect(result).toEqual({ kind: "refused", code: "budget_exceeded" })
  })

  test("B with a replaced sentinel model is budget_exceeded and does not echo it", () => {
    const result = assessCallBudget({
      stage: "b",
      retries: 0,
      calls: [
        { model: CANDIDATE_MODELS[0], count: 1 },
        { model: CANDIDATE_MODELS[1], count: 1 },
        { model: SENTINEL_MODEL_NAME, count: 1 },
      ],
    })
    expect(result).toEqual({ kind: "refused", code: "budget_exceeded" })
    expect(JSON.stringify(result)).not.toContain(SENTINEL_MODEL_NAME)
  })

  test("B that includes the judge model instead of a candidate is budget_exceeded", () => {
    const result = assessCallBudget({
      stage: "b",
      retries: 0,
      calls: [
        { model: JUDGE_MODEL_NAME, count: 1 },
        { model: CANDIDATE_MODELS[1], count: 1 },
        { model: CANDIDATE_MODELS[2], count: 1 },
      ],
    })
    expect(result).toEqual({ kind: "refused", code: "budget_exceeded" })
  })

  test("retries 1 on an over-budget A1 plan is retries_forbidden", () => {
    const result = assessCallBudget({
      stage: "a1",
      retries: 1,
      calls: [{ model: JUDGE_MODEL_NAME, count: 100 }],
    })
    expect(result).toEqual({ kind: "refused", code: "retries_forbidden" })
  })

  test("retries -1 is invalid_plan", () => {
    const result = assessCallBudget({
      stage: "a1",
      retries: -1,
      calls: [{ model: JUDGE_MODEL_NAME, count: 1 }],
    } as unknown as Plan)
    expect(result).toEqual({ kind: "refused", code: "invalid_plan" })
  })

  test("extra apiKey is invalid_plan and the sentinel is absent", () => {
    const result = assessCallBudget({
      stage: "a1",
      retries: 0,
      calls: [{ model: JUDGE_MODEL_NAME, count: 1 }],
      apiKey: "API_KEY_SENTINEL",
    } as unknown as Plan)
    expect(result).toEqual({ kind: "refused", code: "invalid_plan" })
    expect(JSON.stringify(result)).not.toContain("API_KEY_SENTINEL")
  })

  test("a throwing plan proxy is invalid_plan without invoking the trap", () => {
    let trapCount = 0
    const plan = new Proxy(
      {},
      {
        get: () => {
          trapCount += 1
          throw new Error("proxy trap")
        },
      },
    ) as unknown as Plan
    const result = assessCallBudget(plan)
    expect(result).toEqual({ kind: "refused", code: "invalid_plan" })
    expect(trapCount).toBe(0)
  })

  test("a revoked plan proxy is invalid_plan without throwing", () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    const result = assessCallBudget(proxy as unknown as Plan)
    expect(result).toEqual({ kind: "refused", code: "invalid_plan" })
  })

  test("a row count as an enumerable getter is invalid_plan without calling the getter", () => {
    let getterCount = 0
    const row = Object.defineProperty({ model: JUDGE_MODEL_NAME }, "count", {
      enumerable: true,
      get: () => {
        getterCount += 1
        return 1
      },
    }) as unknown as Plan["calls"][number]
    const result = assessCallBudget({
      stage: "a1",
      retries: 0,
      calls: [row],
    })
    expect(result).toEqual({ kind: "refused", code: "invalid_plan" })
    expect(getterCount).toBe(0)
  })

  test("a string count is invalid_plan", () => {
    const result = assessCallBudget({
      stage: "a1",
      retries: 0,
      calls: [
        { model: JUDGE_MODEL_NAME, count: "1" },
      ] as unknown as Plan["calls"],
    })
    expect(result).toEqual({ kind: "refused", code: "invalid_plan" })
  })

  test("an uppercase judge model is budget_exceeded and the uppercase string is absent", () => {
    const uppercaseJudge = JUDGE_MODEL_NAME.toUpperCase()
    const result = assessCallBudget({
      stage: "a1",
      retries: 0,
      calls: [{ model: uppercaseJudge, count: 1 }],
    })
    expect(result).toEqual({ kind: "refused", code: "budget_exceeded" })
    expect(JSON.stringify(result)).not.toContain(uppercaseJudge)
  })

  test("globalThis.fetch is not called and the plan is not mutated", () => {
    const plan: Plan = {
      stage: "a1",
      retries: 0,
      calls: [{ model: JUDGE_MODEL_NAME, count: 4 }],
    }
    const planBefore = JSON.stringify(plan)
    const originalFetch = globalThis.fetch
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch
    const result1 = assessCallBudget(plan)
    const result2 = assessCallBudget(plan)
    globalThis.fetch = originalFetch
    expect(fetchSpy).toHaveBeenCalledTimes(0)
    expect(JSON.stringify(plan)).toBe(planBefore)
    expect(Object.isFrozen(plan)).toBe(false)
    expect(Object.isExtensible(plan)).toBe(true)
    expect(result1).toEqual(result2)
    expect(JSON.stringify([result1, result2])).not.toContain("true")
  })
})
