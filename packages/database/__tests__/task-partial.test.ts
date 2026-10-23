import { describe, expect, test } from "vitest"
import {
  OPEN_TASK_STATUSES,
  taskPriorityValues,
  taskStatusValues,
} from "../src/partials/task"

describe("task partials", () => {
  test("priority is declared low → urgent so an enum DESC sort puts urgent first", () => {
    expect(taskPriorityValues).toEqual(["low", "normal", "high", "urgent"])
  })

  test("open statuses are todo and in_progress", () => {
    expect(OPEN_TASK_STATUSES).toEqual(["todo", "in_progress"])
    expect(taskStatusValues).toEqual([
      "todo",
      "in_progress",
      "done",
      "canceled",
    ])
  })
})
