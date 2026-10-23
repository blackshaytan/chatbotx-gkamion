import { describe, expect, test } from "vitest"
import {
  canDeleteComment,
  canEditComment,
} from "../../src/internal-thread/comment-permissions"

const now = new Date("2026-10-23T12:00:00Z")
const within24h = new Date("2026-10-23T10:00:00Z")
const after24h = new Date("2026-10-22T10:00:00Z")

const comment = (overrides: Record<string, unknown> = {}) => ({
  kind: "comment" as const,
  authorUserId: "u-1",
  authorLabel: null,
  deletedAt: null,
  createdAt: within24h,
  ...overrides,
})

const user = (userId: string, isOwner = false) =>
  ({ kind: "user", userId, isOwner }) as const

describe("canEditComment", () => {
  test("author within 24 hours", () => {
    expect(
      canEditComment({
        message: comment(),
        actor: user("u-1"),
        now,
      }),
    ).toBe(true)
  })

  test("author after 24 hours", () => {
    expect(
      canEditComment({
        message: comment({ createdAt: after24h }),
        actor: user("u-1"),
        now,
      }),
    ).toBe(false)
  })

  test("api token may edit its own label-only comment", () => {
    expect(
      canEditComment({
        message: comment({ authorUserId: null, authorLabel: "Hermes" }),
        actor: { kind: "api", label: "Hermes" },
        now,
      }),
    ).toBe(true)
    expect(
      canEditComment({
        message: comment({ authorUserId: null, authorLabel: "Other" }),
        actor: { kind: "api", label: "Hermes" },
        now,
      }),
    ).toBe(false)
  })

  test("owner cannot edit someone else's comment", () => {
    expect(
      canEditComment({
        message: comment({ authorUserId: "u-2" }),
        actor: user("boss", true),
        now,
      }),
    ).toBe(false)
  })
})

describe("canDeleteComment", () => {
  test("author within 24 hours", () => {
    expect(
      canDeleteComment({
        message: comment(),
        actor: user("u-1"),
        isOwner: false,
        now,
      }),
    ).toBe(true)
  })

  test("author after 24 hours unless owner or api", () => {
    expect(
      canDeleteComment({
        message: comment({ createdAt: after24h }),
        actor: user("u-1"),
        isOwner: false,
        now,
      }),
    ).toBe(false)
    expect(
      canDeleteComment({
        message: comment({ createdAt: after24h }),
        actor: user("boss", true),
        isOwner: true,
        now,
      }),
    ).toBe(true)
    expect(
      canDeleteComment({
        message: comment({ createdAt: after24h }),
        actor: { kind: "api", label: "Hermes" },
        isOwner: false,
        now,
      }),
    ).toBe(true)
  })
})
