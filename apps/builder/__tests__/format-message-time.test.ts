import { describe, expect, test } from "vitest"
import { formatMessageTime } from "@/features/messages/lib/format-message-time"

// Local-time constructors keep these assertions independent of the runner's
// time zone: the helper formats in local time as well.
const NOW = new Date(2026, 9, 22, 21, 45)

describe("formatMessageTime", () => {
  test("shows only the clock time for a message from today", () => {
    expect(formatMessageTime(new Date(2026, 9, 22, 9, 5), NOW)).toBe("09:05")
  })

  test("keeps midnight as 00:00 for a message from today", () => {
    expect(formatMessageTime(new Date(2026, 9, 22, 0, 0), NOW)).toBe("00:00")
  })

  test("adds day and month for a message from earlier this year", () => {
    expect(formatMessageTime(new Date(2026, 0, 3, 18, 30), NOW)).toBe(
      "03.01 18:30",
    )
  })

  test("uses day and month for the same clock time on another day of this year", () => {
    expect(formatMessageTime(new Date(2026, 9, 21, 21, 45), NOW)).toBe(
      "21.10 21:45",
    )
  })

  test("adds the full year for a message from an earlier year", () => {
    expect(formatMessageTime(new Date(2025, 11, 31, 23, 59), NOW)).toBe(
      "31.12.2025 23:59",
    )
  })

  test("uses the full year for the same day and month of an earlier year", () => {
    expect(formatMessageTime(new Date(2025, 9, 22, 12, 0), NOW)).toBe(
      "22.10.2025 12:00",
    )
  })
})
