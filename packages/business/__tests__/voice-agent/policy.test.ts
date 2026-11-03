import { beforeEach, describe, expect, it, vi } from "vitest"

const contactsMock = vi.hoisted(() => vi.fn())
const findWorkspaceMock = vi.hoisted(() => vi.fn())

vi.mock("@chatbotx.io/database/client", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: contactsMock,
      })),
    })),
  },
  eq: (...args: unknown[]) => ({ eq: args }),
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  contactModel: {
    id: "contact.id",
    workspaceId: "contact.workspaceId",
    phoneNumber: "contact.phoneNumber",
    aiCallOptOutAt: "contact.aiCallOptOutAt",
    aiCallOptOutSource: "contact.aiCallOptOutSource",
    blockedAt: "contact.blockedAt",
  },
}))

vi.mock("../../src/workspace/service", () => ({
  workspaceService: { find: findWorkspaceMock },
}))

const { resolveVoiceCallPolicy } = await import("../../src/voice-agent/policy")

describe("resolveVoiceCallPolicy", () => {
  beforeEach(() => {
    contactsMock.mockReset()
    findWorkspaceMock.mockReset()
    findWorkspaceMock.mockResolvedValue({ targetCountry: "RU" })
  })

  it("невалидный номер", async () => {
    const result = await resolveVoiceCallPolicy({
      workspaceId: "1",
      phone: "abc",
    })
    expect(result).toEqual({ canCall: false, reason: "invalidPhone" })
    expect(contactsMock).not.toHaveBeenCalled()
  })

  it("номер не найден — звонить можно", async () => {
    contactsMock.mockResolvedValue([])
    const result = await resolveVoiceCallPolicy({
      workspaceId: "1",
      phone: "+79990000000",
    })
    expect(result).toEqual({ canCall: true, contactIds: [] })
  })

  it("флаг на одном из контактов с номером — optedOut с самым ранним запретом", async () => {
    contactsMock.mockResolvedValue([
      {
        id: "a",
        aiCallOptOutAt: null,
        aiCallOptOutSource: null,
        blockedAt: null,
      },
      {
        id: "b",
        aiCallOptOutAt: new Date("2026-11-01"),
        aiCallOptOutSource: "clientChat",
        blockedAt: null,
      },
      {
        id: "c",
        aiCallOptOutAt: new Date("2026-11-02"),
        aiCallOptOutSource: "manager",
        blockedAt: null,
      },
    ])
    const result = await resolveVoiceCallPolicy({
      workspaceId: "1",
      phone: "89990000000",
    })
    expect(result).toMatchObject({
      canCall: false,
      reason: "optedOut",
      contactId: "b",
      optOutSource: "clientChat",
    })
    const whereArg = contactsMock.mock.calls[0][0] as {
      and: Array<{ eq: unknown[] }>
    }
    expect(whereArg.and).toEqual([
      { eq: ["contact.workspaceId", "1"] },
      { eq: ["contact.phoneNumber", "+79990000000"] },
    ])
  })

  it("blocked без флага — blocked", async () => {
    contactsMock.mockResolvedValue([
      {
        id: "a",
        aiCallOptOutAt: null,
        aiCallOptOutSource: null,
        blockedAt: new Date(),
      },
    ])
    const result = await resolveVoiceCallPolicy({
      workspaceId: "1",
      phone: "+79990000000",
    })
    expect(result).toMatchObject({
      canCall: false,
      reason: "blocked",
      contactId: "a",
    })
  })

  it("флаг важнее блокировки", async () => {
    contactsMock.mockResolvedValue([
      {
        id: "a",
        aiCallOptOutAt: new Date("2026-11-01"),
        aiCallOptOutSource: "manager",
        blockedAt: new Date(),
      },
    ])
    const result = await resolveVoiceCallPolicy({
      workspaceId: "1",
      phone: "+79990000000",
    })
    expect(result).toMatchObject({ reason: "optedOut" })
  })

  it("ошибка чтения — пробрасывается (fail closed делает вызывающий)", async () => {
    contactsMock.mockRejectedValue(new Error("db down"))
    await expect(
      resolveVoiceCallPolicy({ workspaceId: "1", phone: "+79990000000" }),
    ).rejects.toThrow("db down")
  })
})
