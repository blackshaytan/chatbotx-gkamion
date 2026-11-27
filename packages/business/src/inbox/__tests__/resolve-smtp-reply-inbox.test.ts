import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listSmtpInboxesByWorkspace: vi.fn(),
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  inboxRepository: {
    listSmtpInboxesByWorkspace: mocks.listSmtpInboxesByWorkspace,
  },
}))

const { resolveSmtpReplyInbox } = await import("../smtp-ownership")

const WORKSPACE_ID = "w1"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("resolveSmtpReplyInbox", () => {
  test("prefers the viewer's personal inbox over shared", async () => {
    mocks.listSmtpInboxesByWorkspace.mockResolvedValue([
      {
        id: "shared-old",
        name: "Shared Old",
        ownerUserId: null,
        createdAt: new Date("2024-01-01"),
      },
      {
        id: "personal-u2",
        name: "Mine",
        ownerUserId: "u2",
        createdAt: new Date("2024-06-01"),
      },
      {
        id: "shared-new",
        name: "Shared New",
        ownerUserId: null,
        createdAt: new Date("2024-12-01"),
      },
    ])

    const result = await resolveSmtpReplyInbox({
      workspaceId: WORKSPACE_ID,
      viewerUserId: "u2",
    })

    expect(result).toEqual({ id: "personal-u2", name: "Mine" })
  })

  test("falls back to the oldest shared inbox when the viewer has no personal", async () => {
    mocks.listSmtpInboxesByWorkspace.mockResolvedValue([
      {
        id: "shared-old",
        name: "Shared Old",
        ownerUserId: null,
        createdAt: new Date("2024-01-01"),
      },
      {
        id: "personal-u1",
        name: "Other",
        ownerUserId: "u1",
        createdAt: new Date("2024-02-01"),
      },
      {
        id: "shared-new",
        name: "Shared New",
        ownerUserId: null,
        createdAt: new Date("2024-12-01"),
      },
    ])

    const result = await resolveSmtpReplyInbox({
      workspaceId: WORKSPACE_ID,
      viewerUserId: "u2",
    })

    expect(result).toEqual({ id: "shared-old", name: "Shared Old" })
  })

  test("never picks another member's personal inbox", async () => {
    mocks.listSmtpInboxesByWorkspace.mockResolvedValue([
      {
        id: "personal-u1",
        name: "Other",
        ownerUserId: "u1",
        createdAt: new Date("2024-01-01"),
      },
    ])

    const result = await resolveSmtpReplyInbox({
      workspaceId: WORKSPACE_ID,
      viewerUserId: "u2",
      hiddenInboxIds: ["personal-u1"],
    })

    expect(result).toBeNull()
  })

  test("without a viewer only shared inboxes are candidates", async () => {
    mocks.listSmtpInboxesByWorkspace.mockResolvedValue([
      {
        id: "personal-u1",
        name: "Personal",
        ownerUserId: "u1",
        createdAt: new Date("2024-01-01"),
      },
      {
        id: "shared",
        name: "Shared",
        ownerUserId: null,
        createdAt: new Date("2024-06-01"),
      },
    ])

    const result = await resolveSmtpReplyInbox({
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({ id: "shared", name: "Shared" })
  })

  test("skips hidden shared inboxes", async () => {
    mocks.listSmtpInboxesByWorkspace.mockResolvedValue([
      {
        id: "shared-a",
        name: "A",
        ownerUserId: null,
        createdAt: new Date("2024-01-01"),
      },
      {
        id: "shared-b",
        name: "B",
        ownerUserId: null,
        createdAt: new Date("2024-06-01"),
      },
    ])

    const result = await resolveSmtpReplyInbox({
      workspaceId: WORKSPACE_ID,
      viewerUserId: "u2",
      hiddenInboxIds: ["shared-a"],
    })

    expect(result).toEqual({ id: "shared-b", name: "B" })
  })
})
