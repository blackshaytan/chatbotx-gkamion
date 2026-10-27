import { describe, expect, test } from "vitest"
import { assigneeToValue, valueToAssignee } from "../assignee-value"

describe("create task assignee value adapter", () => {
  test.each([
    [{ type: "conversation" } as const, "conversation"],
    [{ type: "user", userId: "5" } as const, "u_5"],
    [{ type: "team", teamId: "7" } as const, "t_7"],
  ])("serializes and parses %j", (assignee, value) => {
    expect(assigneeToValue(assignee)).toBe(value)
    expect(valueToAssignee(value)).toEqual(assignee)
  })

  test("falls back to the conversation assignee for unknown values", () => {
    expect(valueToAssignee("unknown")).toEqual({ type: "conversation" })
    expect(valueToAssignee("u_")).toEqual({ type: "conversation" })
    expect(valueToAssignee("t_")).toEqual({ type: "conversation" })
  })
})
