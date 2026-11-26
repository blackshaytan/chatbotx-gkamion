import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  listPersonalSmtpInboxes: vi.fn(),
  updateOwner: vi.fn(),
  clearOwnerForUser: vi.fn(),
  findMembership: vi.fn(),
  listByWorkspaceId: vi.fn(),
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  inboxRepository: {
    findById: mocks.findById,
    listPersonalSmtpInboxes: mocks.listPersonalSmtpInboxes,
    updateOwner: mocks.updateOwner,
    clearOwnerForUser: mocks.clearOwnerForUser,
  },
}))

vi.mock("../../workspace-member/service", () => ({
  workspaceMemberService: {
    findMembership: mocks.findMembership,
    listByWorkspaceId: mocks.listByWorkspaceId,
  },
}))

const { hiddenContactInboxIds, smtpOwnershipService } = await import(
  "../smtp-ownership"
)

const WORKSPACE_ID = "w1"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("smtpOwnershipService.listHiddenInboxIdsForMember", () => {
  test("superAdmin sees everything without loading personal inboxes", async () => {
    const hidden = await smtpOwnershipService.listHiddenInboxIdsForMember({
      workspaceId: WORKSPACE_ID,
      viewer: { userId: "u2", permissions: { superAdmin: true } },
    })

    expect(hidden).toEqual([])
    expect(mocks.listPersonalSmtpInboxes).not.toHaveBeenCalled()
  })

  test("agent sees their own personal inbox but not another member's", async () => {
    mocks.listPersonalSmtpInboxes.mockResolvedValue([
      { id: "i1", ownerUserId: "u1" },
      { id: "i2", ownerUserId: "u2" },
    ])

    const hidden = await smtpOwnershipService.listHiddenInboxIdsForMember({
      workspaceId: WORKSPACE_ID,
      viewer: { userId: "u2", permissions: { superAdmin: false } },
    })

    expect(hidden).toEqual(["i1"])
    expect(mocks.listPersonalSmtpInboxes).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
    })
  })

  test("fails closed when permissions omit superAdmin", async () => {
    mocks.listPersonalSmtpInboxes.mockResolvedValue([
      { id: "i1", ownerUserId: "u1" },
    ])

    const hidden = await smtpOwnershipService.listHiddenInboxIdsForMember({
      workspaceId: WORKSPACE_ID,
      viewer: { userId: "u2", permissions: {} },
    })

    expect(hidden).toEqual(["i1"])
  })

  test("returns nothing hidden when the workspace has no personal inboxes", async () => {
    mocks.listPersonalSmtpInboxes.mockResolvedValue([])

    const hidden = await smtpOwnershipService.listHiddenInboxIdsForMember({
      workspaceId: WORKSPACE_ID,
      viewer: { userId: "u2", permissions: { superAdmin: false } },
    })

    expect(hidden).toEqual([])
  })
})

describe("hiddenContactInboxIds", () => {
  test("maps hidden inbox ids to their contact inbox ids", () => {
    const contactInboxIds = hiddenContactInboxIds(
      [
        { id: "ci1", inboxId: "i1" },
        { id: "ci2", inboxId: "i9" },
      ],
      ["i1"],
    )

    expect(contactInboxIds).toEqual(["ci1"])
  })

  test("returns nothing when no inboxes are hidden", () => {
    expect(
      hiddenContactInboxIds([{ id: "ci1", inboxId: "i1" }], undefined),
    ).toEqual([])
    expect(hiddenContactInboxIds([{ id: "ci1", inboxId: "i1" }], [])).toEqual(
      [],
    )
  })
})

describe("smtpOwnershipService.resolveAudienceUserIds", () => {
  test("shared inbox resolves to null", async () => {
    mocks.findById.mockResolvedValue({
      id: "i1",
      workspaceId: WORKSPACE_ID,
      channel: "smtp",
      ownerUserId: null,
    })

    const audience = await smtpOwnershipService.resolveAudienceUserIds({
      workspaceId: WORKSPACE_ID,
      inboxId: "i1",
    })

    expect(audience).toBeNull()
  })

  test("non-smtp inbox resolves to null", async () => {
    mocks.findById.mockResolvedValue({
      id: "i1",
      workspaceId: WORKSPACE_ID,
      channel: "whatsapp",
      ownerUserId: "u1",
    })

    const audience = await smtpOwnershipService.resolveAudienceUserIds({
      workspaceId: WORKSPACE_ID,
      inboxId: "i1",
    })

    expect(audience).toBeNull()
  })

  test("inbox from another workspace resolves to null", async () => {
    mocks.findById.mockResolvedValue({
      id: "i1",
      workspaceId: "other",
      channel: "smtp",
      ownerUserId: "u1",
    })

    const audience = await smtpOwnershipService.resolveAudienceUserIds({
      workspaceId: WORKSPACE_ID,
      inboxId: "i1",
    })

    expect(audience).toBeNull()
  })

  test("personal inbox resolves to owner plus admins, deduped", async () => {
    mocks.findById.mockResolvedValue({
      id: "i1",
      workspaceId: WORKSPACE_ID,
      channel: "smtp",
      ownerUserId: "u1",
    })
    mocks.listByWorkspaceId.mockResolvedValue([
      { userId: "u1", role: "agent", permissions: { superAdmin: true } },
      { userId: "u3", role: "owner", permissions: {} },
      { userId: "u4", role: "agent", permissions: { superAdmin: false } },
    ])

    const audience = await smtpOwnershipService.resolveAudienceUserIds({
      workspaceId: WORKSPACE_ID,
      inboxId: "i1",
    })

    expect(audience).toEqual(["u1", "u3"])
  })
})

describe("smtpOwnershipService.setOwner", () => {
  test("rejects a non-smtp inbox", async () => {
    mocks.findById.mockResolvedValue({
      id: "i1",
      workspaceId: WORKSPACE_ID,
      channel: "whatsapp",
      ownerUserId: null,
    })

    await expect(
      smtpOwnershipService.setOwner({
        workspaceId: WORKSPACE_ID,
        inboxId: "i1",
        ownerUserId: "u1",
      }),
    ).rejects.toMatchObject({
      code: "smtpOwnerInvalidChannel",
      httpStatusCode: 400,
    })
    expect(mocks.updateOwner).not.toHaveBeenCalled()
  })

  test("rejects an owner who is not a workspace member", async () => {
    mocks.findById.mockResolvedValue({
      id: "i1",
      workspaceId: WORKSPACE_ID,
      channel: "smtp",
      ownerUserId: null,
    })
    mocks.findMembership.mockResolvedValue(undefined)

    await expect(
      smtpOwnershipService.setOwner({
        workspaceId: WORKSPACE_ID,
        inboxId: "i1",
        ownerUserId: "u9",
      }),
    ).rejects.toMatchObject({
      code: "smtpOwnerNotMember",
      httpStatusCode: 400,
    })
    expect(mocks.updateOwner).not.toHaveBeenCalled()
  })

  test("rejects an inbox from another workspace as not found", async () => {
    mocks.findById.mockResolvedValue({
      id: "i1",
      workspaceId: "other",
      channel: "smtp",
      ownerUserId: null,
    })

    await expect(
      smtpOwnershipService.setOwner({
        workspaceId: WORKSPACE_ID,
        inboxId: "i1",
        ownerUserId: null,
      }),
    ).rejects.toMatchObject({
      code: "smtpOwnerInboxNotFound",
      httpStatusCode: 404,
    })
    expect(mocks.updateOwner).not.toHaveBeenCalled()
  })

  test("writes a valid member as owner", async () => {
    const tx = { marker: "tx" }
    mocks.findById.mockResolvedValue({
      id: "i1",
      workspaceId: WORKSPACE_ID,
      channel: "smtp",
      ownerUserId: null,
    })
    mocks.findMembership.mockResolvedValue({ userId: "u1" })

    await smtpOwnershipService.setOwner({
      workspaceId: WORKSPACE_ID,
      inboxId: "i1",
      ownerUserId: "u1",
      tx: tx as never,
    })

    expect(mocks.findMembership).toHaveBeenCalledWith({
      tx,
      workspaceId: WORKSPACE_ID,
      userId: "u1",
    })
    expect(mocks.updateOwner).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      inboxId: "i1",
      ownerUserId: "u1",
      tx,
    })
  })

  test("null clears the owner without a member lookup", async () => {
    mocks.findById.mockResolvedValue({
      id: "i1",
      workspaceId: WORKSPACE_ID,
      channel: "smtp",
      ownerUserId: "u1",
    })

    await smtpOwnershipService.setOwner({
      workspaceId: WORKSPACE_ID,
      inboxId: "i1",
      ownerUserId: null,
    })

    expect(mocks.findMembership).not.toHaveBeenCalled()
    expect(mocks.updateOwner).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: null }),
    )
  })
})

describe("smtpOwnershipService.clearOwnerForUser", () => {
  test("delegates to the repository with the same props", async () => {
    const tx = { marker: "tx" }

    await smtpOwnershipService.clearOwnerForUser({
      workspaceId: WORKSPACE_ID,
      userId: "u1",
      tx: tx as never,
    })

    expect(mocks.clearOwnerForUser).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      userId: "u1",
      tx,
    })
  })
})
