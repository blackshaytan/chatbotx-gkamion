import { describe, expect, test } from "vitest"
import {
  REMINDER_PRESETS,
  remindAtFromPreset,
} from "@/features/tasks/lib/reminder-presets"

describe("task reminder presets", () => {
  test("lists the available presets", () => {
    expect(REMINDER_PRESETS).toEqual(["min15", "hour1", "day1"])
  })

  test.each([
    ["min15", "2026-10-23T11:45:00.000Z"],
    ["hour1", "2026-10-23T11:00:00.000Z"],
    ["day1", "2026-10-22T12:00:00.000Z"],
  ] as const)("calculates %s before the due date", (preset, expected) => {
    const dueAt = new Date("2026-10-23T12:00:00.000Z")

    expect(remindAtFromPreset(dueAt, preset).toISOString()).toBe(expected)
    expect(dueAt.toISOString()).toBe("2026-10-23T12:00:00.000Z")
  })
})
