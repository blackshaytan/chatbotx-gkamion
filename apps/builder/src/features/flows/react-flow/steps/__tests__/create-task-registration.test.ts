import { readFileSync } from "node:fs"
import {
  actionSteps,
  createTaskStepDefaultFn,
  createTaskStepSchema,
  stepTypes,
} from "@chatbotx.io/flow-config"
import { describe, expect, test } from "vitest"

describe("createTask step registration", () => {
  test("registers a valid default in the shared action union", () => {
    const value = {
      ...createTaskStepDefaultFn(),
      title: "Follow up",
    }

    expect(stepTypes.enum.createTask).toBe("createTask")
    expect(createTaskStepSchema.safeParse(value).success).toBe(true)
    expect(actionSteps.some((schema) => schema.safeParse(value).success)).toBe(
      true,
    )
  })

  test("is wired into the builder step registry", () => {
    const source = readFileSync(
      "src/features/flows/react-flow/steps/index.tsx",
      "utf8",
    )

    expect(source).toContain('import { createTaskStep } from "./create-task"')
    expect(source).toContain("[stepTypes.enum.createTask]: createTaskStep")
  })

  test("appears in the perform action menu", () => {
    const source = readFileSync(
      "src/features/flows/react-flow/nodes/perform-action/menu.tsx",
      "utf8",
    )

    expect(source).toContain("stepType: stepTypes.enum.createTask")
  })

  test("renders state viewers without raw handles", () => {
    const source = readFileSync(
      "src/features/flows/react-flow/steps/create-task/viewer.tsx",
      "utf8",
    )

    expect(source).toContain("BaseStateViewer")
    expect(source).toContain("data.states.map")
    expect(source).not.toContain("<Handle")
  })

  test("remains a step rather than a node type", () => {
    const source = readFileSync(
      "src/features/flows/react-flow/nodes/node-config.tsx",
      "utf8",
    )

    expect(source).not.toContain("createTask")
  })
})
