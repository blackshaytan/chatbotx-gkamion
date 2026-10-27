import { describe, expect, test } from "vitest"
import {
  actionSteps,
  CHANNEL_FLOW_POLICIES,
  createTaskStepDefaultFn,
  createTaskStepSchema,
  stepSupport,
} from "../src"

describe("Create task flow contract", () => {
  test("creates safe defaults with stable state ids", () => {
    const value = createTaskStepDefaultFn()
    expect(value).toMatchObject({
      stepType: "createTask",
      assignee: { type: "conversation" },
    })
    expect(value.states.map((state) => state.stateType)).toEqual([
      "success",
      "error",
    ])
    expect(value.states.every((state) => Boolean(state.id))).toBe(true)
  })

  const validBase = () => ({
    ...createTaskStepDefaultFn(),
    title: "Follow up with contact",
  })

  test("empty title fails schema validation", () => {
    expect(
      createTaskStepSchema.safeParse(createTaskStepDefaultFn()).success,
    ).toBe(false)
  })

  test("title passes schema validation", () => {
    expect(createTaskStepSchema.safeParse(validBase()).success).toBe(true)
  })

  test("is registered in the shared action union", () => {
    const value = validBase()
    expect(actionSteps.some((schema) => schema.safeParse(value).success)).toBe(
      true,
    )
  })

  test("user assignee without userId fails", () => {
    const value = {
      ...validBase(),
      assignee: { type: "user" },
    }
    expect(createTaskStepSchema.safeParse(value).success).toBe(false)
  })

  test("team assignee with teamId passes", () => {
    const value = {
      ...validBase(),
      assignee: { type: "team", teamId: "7" },
    }
    expect(createTaskStepSchema.safeParse(value).success).toBe(true)
  })

  test.each([
    { type: "user", userId: "1234567890123456789" },
    { type: "team", teamId: "1234567890123456789" },
  ])("rejects an assignee id that can overflow bigint", (assignee) => {
    const value = {
      ...validBase(),
      assignee,
    }
    expect(createTaskStepSchema.safeParse(value).success).toBe(false)
  })

  test("conversation assignee passes", () => {
    expect(createTaskStepSchema.safeParse(validBase()).success).toBe(true)
  })

  test("dueIn with valid amount passes", () => {
    const value = {
      ...validBase(),
      dueIn: { amount: 2, unit: "hours" },
    }
    expect(createTaskStepSchema.safeParse(value).success).toBe(true)
  })

  test("dueIn with zero amount fails", () => {
    const value = {
      ...validBase(),
      dueIn: { amount: 0, unit: "hours" },
    }
    expect(createTaskStepSchema.safeParse(value).success).toBe(false)
  })

  test("reminder without due date fails", () => {
    const value = {
      ...validBase(),
      remindBeforeMinutes: 10,
      dueIn: null,
    }
    expect(createTaskStepSchema.safeParse(value).success).toBe(false)
  })

  test("reminder later than due window fails", () => {
    const value = {
      ...validBase(),
      dueIn: { amount: 30, unit: "minutes" },
      remindBeforeMinutes: 31,
    }
    expect(createTaskStepSchema.safeParse(value).success).toBe(false)
  })

  test("reminder equal to due window passes", () => {
    const value = {
      ...validBase(),
      dueIn: { amount: 30, unit: "minutes" },
      remindBeforeMinutes: 30,
    }
    expect(createTaskStepSchema.safeParse(value).success).toBe(true)
  })

  test("null reminder and null due pass", () => {
    const value = {
      ...validBase(),
      dueIn: null,
      remindBeforeMinutes: null,
    }
    expect(createTaskStepSchema.safeParse(value).success).toBe(true)
  })

  test("outputFieldId empty string passes", () => {
    expect(createTaskStepSchema.safeParse(validBase()).success).toBe(true)
  })

  test("outputFieldId numeric custom field passes", () => {
    const value = { ...validBase(), outputFieldId: "123" }
    expect(createTaskStepSchema.safeParse(value).success).toBe(true)
  })

  test("outputFieldId invalid bot field fails", () => {
    const value = { ...validBase(), outputFieldId: "bot_field:abc" }
    expect(createTaskStepSchema.safeParse(value).success).toBe(false)
  })

  test("outputFieldId valid bot field passes", () => {
    const value = { ...validBase(), outputFieldId: "bot_field:5" }
    expect(createTaskStepSchema.safeParse(value).success).toBe(true)
  })

  test("createTask is full on every channel policy", () => {
    for (const channel of Object.keys(CHANNEL_FLOW_POLICIES)) {
      expect(CHANNEL_FLOW_POLICIES[channel].steps.createTask).toBe(
        stepSupport.full,
      )
    }
  })
})
