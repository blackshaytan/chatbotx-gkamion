import { beforeEach, describe, expect, it, vi } from "vitest"

const queryFirstMock = vi.hoisted(() => vi.fn())
const queryManyMock = vi.hoisted(() => vi.fn())
const findWorkspaceMock = vi.hoisted(() => vi.fn())
const updateSetMock = vi.hoisted(() => vi.fn())
const updateReturningMock = vi.hoisted(() => vi.fn())
const invalidateCacheByTagsMock = vi.hoisted(() => vi.fn())
const normalizePhoneToE164Mock = vi.hoisted(() => vi.fn())

const insertedContactRecords = vi.hoisted(() => [] as Record<string, unknown>[])
const insertedNoteRecords = vi.hoisted(() => [] as Record<string, unknown>[])

const mockedContactModel = vi.hoisted(() => ({
  id: "contact.id",
  workspaceId: "contact.workspaceId",
  phoneNumber: "contact.phoneNumber",
  aiCallOptOutAt: "contact.aiCallOptOutAt",
  aiCallOptOutSource: "contact.aiCallOptOutSource",
  aiCallOptOutReason: "contact.aiCallOptOutReason",
}))

const mockedContactNoteModel = vi.hoisted(() => ({
  id: "contactNote.id",
  contactId: "contactNote.contactId",
  text: "contactNote.text",
  createdById: "contactNote.createdById",
}))

vi.mock("@chatbotx.io/database/client", () => {
  const tx = {
    query: {
      contactModel: {
        findFirst: queryFirstMock,
        findMany: queryManyMock,
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateSetMock(values)
        return {
          where: vi.fn(() => ({
            returning: vi.fn(() => updateReturningMock()),
          })),
        }
      }),
    })),
    insert: vi.fn((model: Record<string, unknown>) => ({
      values: vi.fn((values: unknown) => {
        const items = Array.isArray(values) ? values : [values]
        if (model === mockedContactModel) {
          insertedContactRecords.push(...items)
        } else if (model === mockedContactNoteModel) {
          insertedNoteRecords.push(...items)
        }
        return Promise.resolve([])
      }),
    })),
  }

  return {
    and: (...args: unknown[]) => ({ and: args }),
    db: {
      transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    },
    eq: (...args: unknown[]) => ({ eq: args }),
    inArray: (...args: unknown[]) => ({ inArray: args }),
    isNotNull: (...args: unknown[]) => ({ isNotNull: args }),
    isNull: (...args: unknown[]) => ({ isNull: args }),
  }
})

vi.mock("@chatbotx.io/database/schema", () => ({
  contactModel: mockedContactModel,
  contactNoteModel: mockedContactNoteModel,
}))

vi.mock("@chatbotx.io/redis", () => ({
  invalidateCacheByTags: invalidateCacheByTagsMock,
}))

vi.mock("@chatbotx.io/utils", () => ({
  createId: vi.fn(() => "new-id"),
}))

vi.mock("../../src/workspace/service", () => ({
  workspaceService: { find: findWorkspaceMock },
}))

vi.mock("../../src/contact/phone", () => ({
  normalizePhoneToE164: normalizePhoneToE164Mock,
}))

const { voiceAgentService } = await import("../../src/voice-agent/service")

const insertedContacts = () => insertedContactRecords
const insertedNotes = () => insertedNoteRecords

beforeEach(() => {
  vi.resetAllMocks()
  insertedContactRecords.length = 0
  insertedNoteRecords.length = 0
  findWorkspaceMock.mockResolvedValue({ targetCountry: "RU" })
  normalizePhoneToE164Mock.mockImplementation((phone: string) =>
    phone.startsWith("+") ? phone : null,
  )
  invalidateCacheByTagsMock.mockResolvedValue(undefined)
})

describe("voiceAgentService.setAiCallOptOut", () => {
  it("ставит флаг на все контакты с номером и пишет заметку каждому", async () => {
    queryFirstMock.mockResolvedValue({
      id: "a",
      phoneNumber: "+79990000000",
    })
    queryManyMock.mockResolvedValue([{ id: "a" }, { id: "b" }])
    updateReturningMock.mockResolvedValue([{ id: "a" }, { id: "b" }])

    const result = await voiceAgentService.setAiCallOptOut({
      workspaceId: "1",
      contactId: "a",
      source: "clientChat",
      reason: "не звоните мне больше",
    })

    expect(result.contactIds.sort()).toEqual(["a", "b"])
    expect(result.alreadySet).toBe(false)
    expect(queryFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "a", workspaceId: "1" },
      }),
    )
    expect(queryManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "1", phoneNumber: "+79990000000" },
      }),
    )
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ aiCallOptOutSource: "clientChat" }),
    )
    expect(insertedNotes()).toHaveLength(2)
    expect(insertedNotes()[0]?.text).toContain("не звоните мне больше")
  })

  it("повторный вызов не перезаписывает источник и не дублирует заметку", async () => {
    queryFirstMock.mockResolvedValue({
      id: "a",
      phoneNumber: "+79990000000",
    })
    queryManyMock.mockResolvedValue([{ id: "a" }, { id: "b" }])
    updateReturningMock.mockResolvedValue([])

    const result = await voiceAgentService.setAiCallOptOut({
      workspaceId: "1",
      contactId: "a",
      source: "manager",
    })

    expect(result.alreadySet).toBe(true)
    expect(insertedNotes()).toHaveLength(0)
  })

  it("контакт без телефона: флаг ставится, заметка предупреждает", async () => {
    queryFirstMock.mockResolvedValue({ id: "tg", phoneNumber: null })
    updateReturningMock.mockResolvedValue([{ id: "tg" }])

    const result = await voiceAgentService.setAiCallOptOut({
      workspaceId: "1",
      contactId: "tg",
      source: "clientChat",
      reason: "хватит звонить",
    })

    expect(result.contactIds).toEqual(["tg"])
    expect(queryFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tg", workspaceId: "1" },
      }),
    )
    expect(insertedNotes()[0]?.text).toContain("нет телефона")
  })

  it("неизвестный номер создаёт standalone-контакт и ставит флаг ему", async () => {
    queryManyMock.mockResolvedValue([])
    updateReturningMock.mockResolvedValue([{ id: "new-id" }])

    const result = await voiceAgentService.setAiCallOptOut({
      workspaceId: "1",
      phone: "+79990000000",
      source: "clientCall",
      reason: "не звоните мне",
    })

    expect(result.contactIds).toHaveLength(1)
    expect(queryManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "1", phoneNumber: "+79990000000" },
      }),
    )
    expect(insertedContacts()[0]).toMatchObject({
      phoneNumber: "+79990000000",
    })
    expect(insertedContacts()[0]?.inboxId).toBeUndefined()
  })

  it("contactId + phone: сначала загружает контакт, ищет по переданному номеру", async () => {
    queryFirstMock.mockResolvedValue({
      id: "a",
      phoneNumber: "+79990000000",
    })
    queryManyMock.mockResolvedValue([{ id: "a" }, { id: "b" }])
    updateReturningMock.mockResolvedValue([{ id: "a" }, { id: "b" }])

    const result = await voiceAgentService.setAiCallOptOut({
      workspaceId: "1",
      contactId: "a",
      phone: "+79991111111",
      source: "clientCall",
    })

    expect(result.contactIds.sort()).toEqual(["a", "b"])
    expect(queryFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "a", workspaceId: "1" },
      }),
    )
    expect(queryManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "1", phoneNumber: "+79991111111" },
      }),
    )
  })

  it("contactId несуществующего контакта — 404", async () => {
    queryFirstMock.mockResolvedValue(null)

    await expect(
      voiceAgentService.setAiCallOptOut({
        workspaceId: "1",
        contactId: "missing",
        source: "clientChat",
      }),
    ).rejects.toThrow("Contact not found")

    expect(queryManyMock).not.toHaveBeenCalled()
  })

  it("нет ни contactId, ни phone — ошибка", async () => {
    await expect(
      voiceAgentService.setAiCallOptOut({
        workspaceId: "1",
        source: "manager",
      }),
    ).rejects.toThrow()
  })

  it("phone abc отклоняется и ничего не создаёт", async () => {
    normalizePhoneToE164Mock.mockReturnValue(null)

    await expect(
      voiceAgentService.setAiCallOptOut({
        workspaceId: "1",
        phone: "abc",
        source: "clientCall",
      }),
    ).rejects.toThrow("Phone is invalid")

    expect(insertedContacts()).toHaveLength(0)
    expect(insertedNotes()).toHaveLength(0)
  })
})

describe("voiceAgentService.clearAiCallOptOut", () => {
  it("clear снимает флаг со всех контактов с номером и пишет заметку", async () => {
    queryFirstMock.mockResolvedValue({
      id: "a",
      phoneNumber: "+79990000000",
    })
    queryManyMock.mockResolvedValue([{ id: "a" }, { id: "b" }])
    updateReturningMock.mockResolvedValue([{ id: "a" }, { id: "b" }])

    const result = await voiceAgentService.clearAiCallOptOut({
      workspaceId: "1",
      contactId: "a",
      actorUserId: "user-1",
    })

    expect(result.contactIds.sort()).toEqual(["a", "b"])
    expect(queryFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "a", workspaceId: "1" },
      }),
    )
    expect(queryManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "1", phoneNumber: "+79990000000" },
      }),
    )
    expect(insertedNotes()).toHaveLength(2)
    expect(insertedNotes()[0]?.text).toContain("Менеджер снял запрет")
  })
})
