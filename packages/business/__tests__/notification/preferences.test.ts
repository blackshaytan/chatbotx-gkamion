import { describe, expect, test } from "vitest"
import {
  isTaskNotificationEnabled,
  readTaskNotificationPreferences,
} from "../../src/notification/preferences"

describe("task notification preferences", () => {
  test("missing task key defaults to enabled", () => {
    expect(
      isTaskNotificationEnabled(
        { notifyAdmin: true, newMessageToHuman: true, newOrder: true },
        "taskAssigned",
      ),
    ).toBe(true)
  })

  test("explicit false disables the type", () => {
    expect(
      isTaskNotificationEnabled(
        {
          notifyAdmin: true,
          newMessageToHuman: true,
          newOrder: true,
          taskAssigned: false,
        },
        "taskAssigned",
      ),
    ).toBe(false)
  })

  test("readTaskNotificationPreferences returns all seven types", () => {
    const prefs = readTaskNotificationPreferences({
      notifyAdmin: true,
      newMessageToHuman: true,
      newOrder: true,
      taskCommented: false,
    })
    expect(Object.keys(prefs)).toHaveLength(7)
    expect(prefs.taskCommented).toBe(false)
    expect(prefs.taskMentioned).toBe(true)
  })
})
