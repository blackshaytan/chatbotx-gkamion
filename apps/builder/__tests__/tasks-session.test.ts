// @vitest-environment node

import { describe, expect, test, vi } from "vitest"

vi.mock("@chatbotx.io/database/client", () => {
  const proxy: unknown = new Proxy(() => proxy, { get: () => proxy })
  return { db: proxy, sql: proxy }
})

import {
  sessionTaskAccessScope,
  sessionTaskActor,
  tabToFilter,
} from "@/features/tasks/lib/session"

describe("tabToFilter", () => {
  test.each([
    ["mine", { assigneeUserId: "7" }],
    ["createdByMe", { createdByUserId: "7" }],
    ["watching", { watcherUserId: "7" }],
    ["myTeams", { teamMemberUserId: "7" }],
    ["all", {}],
  ] as const)("tab %s", (tab, expected) => {
    expect(tabToFilter(tab, "7")).toEqual(expected)
  })
})

describe("sessionTaskActor", () => {
  test("marks owner when user id matches workspace owner", () => {
    expect(
      sessionTaskActor({
        user: { id: "7" },
        workspace: { ownerId: "7" },
      }),
    ).toEqual({ kind: "user", userId: "7", isOwner: true })
  })
})

const noPermissions = {
  superAdmin: false,
  analytics: false,
  flows: false,
  contacts: false,
  onlyAssignedContacts: false,
  emailAndPhone: false,
  broadcast: false,
  ecommerce: false,
}

describe("sessionTaskAccessScope", () => {
  test("hides targets when contacts access is denied", () => {
    expect(
      sessionTaskAccessScope({
        permissions: { ...noPermissions },
        userId: "7",
      }),
    ).toEqual({ hideTargets: true })
  })

  test("restricts to assigned contacts when onlyAssignedContacts is set", () => {
    expect(
      sessionTaskAccessScope({
        permissions: {
          ...noPermissions,
          contacts: true,
          onlyAssignedContacts: true,
        },
        userId: "7",
      }),
    ).toEqual({ restrictToAssignedUserId: "7" })
  })
})
