// @vitest-environment node

import { describe, expect, test } from "vitest"
import { resolveActiveContactInbox } from "../contact-inbox"

const inbox = (
  id: string,
  channel: string,
  lastMessageAt: Date | string | null,
) => ({
  id,
  channel,
  lastMessageAt,
})

// The real case this guards: a contact whose dialog was opened through an
// order email and who then wrote on ZZAP. The DM conversation is shared, so
// the reply channel must follow the newest message, not the array order.
const mergedDialog = [
  inbox("smtp-row", "smtp", new Date("2026-11-09T22:37:13.540Z")),
  inbox("zzap-row", "zzap", new Date("2026-11-10T07:14:59.778Z")),
]

describe("resolveActiveContactInbox", () => {
  test("picks the inbox with the latest message, not the first element", () => {
    expect(resolveActiveContactInbox(mergedDialog)?.id).toBe("zzap-row")
  })

  test("does not care about the list order", () => {
    const reversed = [...mergedDialog].reverse()
    expect(resolveActiveContactInbox(reversed)?.id).toBe("zzap-row")
  })

  test("accepts serialized (string) timestamps from the API", () => {
    const rows = [
      inbox("older", "smtp", "2026-11-09T22:37:13.540Z"),
      inbox("newer", "zzap", "2026-11-10T07:14:59.778Z"),
    ]
    expect(resolveActiveContactInbox(rows)?.id).toBe("newer")
  })

  test("keeps the first inbox when no inbox has a message yet", () => {
    const rows = [inbox("a", "smtp", null), inbox("b", "zzap", null)]
    expect(resolveActiveContactInbox(rows)?.id).toBe("a")
  })

  test("uses the first inbox when the row has no lastMessageAt", () => {
    const rows = [
      { id: "a", channel: "smtp", source: "widget" },
      { id: "b", channel: "zzap", source: "widget" },
    ]
    expect(resolveActiveContactInbox(rows)?.channel).toBe("smtp")
  })

  test("returns undefined for an empty or missing list", () => {
    expect(resolveActiveContactInbox([])).toBeUndefined()
    expect(resolveActiveContactInbox(null)).toBeUndefined()
    expect(resolveActiveContactInbox(undefined)).toBeUndefined()
  })
})
