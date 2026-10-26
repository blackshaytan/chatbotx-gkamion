import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const CREATE_TASK_HANDLER_IMPORT_PATTERN =
  /import \{ handleCreateTask \} from "\.\/create-task-handler"/

describe("Create task worker step registration", () => {
  test("dispatches createTask steps to handleCreateTask", () => {
    const stepSource = readFileSync("src/integration/handlers/step.ts", "utf8")
    expect(stepSource).toMatch(CREATE_TASK_HANDLER_IMPORT_PATTERN)
    expect(stepSource).toContain(
      "[stepTypes.enum.createTask]: handleCreateTask",
    )

    const flowUtilsSource = readFileSync(
      "src/integration/handlers/flow-utils.ts",
      "utf8",
    )
    expect(flowUtilsSource).toContain("createTask: false")
  })
})
