import { beforeEach, describe, expect, test, vi } from "vitest"

const {
  mockFindFirstWorkspace,
  mockFindFirstContact,
  mockFindManyIntegrationSmtp,
  mockUpdate,
  mockSet,
  mockWhere,
  mockEmitContactInfoUpdated,
} = vi.hoisted(() => ({
  mockFindFirstWorkspace: vi.fn(),
  mockFindFirstContact: vi.fn(),
  mockFindManyIntegrationSmtp: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
  mockEmitContactInfoUpdated: vi.fn(),
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: {
    update: mockUpdate,
    query: {
      workspaceModel: { findFirst: mockFindFirstWorkspace },
      contactModel: { findFirst: mockFindFirstContact },
      integrationSmtpModel: { findMany: mockFindManyIntegrationSmtp },
    },
  },
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
  eq: vi.fn(),
}))

vi.mock("@chatbotx.io/events", () => ({
  emitContactInfoUpdated: mockEmitContactInfoUpdated,
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  contactModel: {
    id: "id",
    phoneNumber: "phoneNumber",
    email: "email",
    workspaceId: "workspaceId",
  },
}))

import { updateContactFromMessage } from "../src/contact/update-from-message"

beforeEach(() => {
  vi.clearAllMocks()
  mockFindFirstWorkspace.mockResolvedValue({ targetCountry: "VN" })
  mockFindFirstContact.mockResolvedValue({ phoneNumber: null, email: null })
  mockFindManyIntegrationSmtp.mockResolvedValue([])
  mockSet.mockReturnValue({ where: mockWhere })
  mockWhere.mockResolvedValue(undefined)
  mockUpdate.mockReturnValue({ set: mockSet })
})

describe("updateContactFromMessage", () => {
  test("no-ops on empty text — no workspace lookup, no update", async () => {
    const result = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "",
    })
    expect(result).toEqual({})
    expect(mockFindFirstWorkspace).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test("no-ops on null text", async () => {
    const result = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: null,
    })
    expect(result).toEqual({})
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test("phone-only message → updates phoneNumber only", async () => {
    const result = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "call me at 0912345678",
    })
    expect(result).toEqual({ phoneNumber: "+84912345678" })
    expect(mockSet).toHaveBeenCalledWith({ phoneNumber: "+84912345678" })
  })

  test("email-only message → updates email only", async () => {
    const result = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "reach me at jane@acme.com",
    })
    expect(result).toEqual({ email: "jane@acme.com" })
    expect(mockSet).toHaveBeenCalledWith({ email: "jane@acme.com" })
  })

  test("both phone + email → single UPDATE with both fields", async () => {
    const result = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "phone 0912345678 mail jane@acme.com",
    })
    expect(result).toEqual({
      phoneNumber: "+84912345678",
      email: "jane@acme.com",
    })
    expect(mockSet).toHaveBeenCalledOnce()
    expect(mockSet).toHaveBeenCalledWith({
      phoneNumber: "+84912345678",
      email: "jane@acme.com",
    })
  })

  test("no extraction match → no UPDATE", async () => {
    const result = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "hello how are you today",
    })
    expect(result).toEqual({})
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test("missing workspace.targetCountry falls back to extractor defaults", async () => {
    mockFindFirstWorkspace.mockResolvedValueOnce(undefined)
    const result = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "ring +84 912 345 678",
    })
    expect(result.phoneNumber).toBe("+84912345678")
    expect(mockSet).toHaveBeenCalledWith({ phoneNumber: "+84912345678" })
  })

  test("reads the contact row only on extraction hits — no-match path stays query-free", async () => {
    await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "hello how are you today",
    })
    expect(mockFindFirstContact).not.toHaveBeenCalled()

    await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "new number 0912345678",
    })
    expect(mockFindFirstContact).toHaveBeenCalledOnce()
    expect(mockSet).toHaveBeenCalledWith({ phoneNumber: "+84912345678" })
  })

  test("emits contactInfoUpdated with old and new values when the phone changed", async () => {
    mockFindFirstContact.mockResolvedValueOnce({
      phoneNumber: "+84900000000",
      email: null,
    })
    await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "new number 0912345678",
    })
    expect(mockEmitContactInfoUpdated).toHaveBeenCalledExactlyOnceWith(
      "w1",
      "c1",
      "phone",
      "+84900000000",
      "+84912345678",
    )
  })

  test("does not emit when the extracted value matches the stored value", async () => {
    mockFindFirstContact.mockResolvedValueOnce({
      phoneNumber: "+84912345678",
      email: null,
    })
    await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "same number 0912345678",
    })
    expect(mockEmitContactInfoUpdated).not.toHaveBeenCalled()
  })

  test("does not emit when the contact row no longer exists", async () => {
    mockFindFirstContact.mockResolvedValueOnce(undefined)
    await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "new number 0912345678",
    })
    expect(mockEmitContactInfoUpdated).not.toHaveBeenCalled()
  })

  test("channel-agnostic: same call shape works for any caller (no channel arg)", async () => {
    // The helper takes no channel param — callers from messenger, whatsapp,
    // telegram, zalo, webchat all invoke it the same way. Asserting the
    // surface (3 props only) is what every channel touches it with.
    const props = {
      contactId: "c1",
      workspaceId: "w1",
      text: "ping 0912345678",
    }
    await updateContactFromMessage(props)
    expect(mockSet).toHaveBeenCalledWith({ phoneNumber: "+84912345678" })
  })

  test("reproduces production incident: SMTP reply quoting Russian part number does not update contact", async () => {
    mockFindFirstWorkspace.mockResolvedValue({ targetCountry: "RU" })
    const text =
      "Subject: Re: возврат детали такой-то\n\nВсе получил, спасибо!\n\nвт, 24 нояб. 2026 г. в 16:34, Баринов Станислав <s.barinov@gkamion.ru>:\n\n> Здравствуйте отказ клиента арт. 602002394AA 5 штук"
    const result = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text,
      channel: "smtp",
    })
    expect(result).toEqual({})
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test("channel: 'smtp' with valid Russian phone and email in body updates ONLY phoneNumber", async () => {
    mockFindFirstWorkspace.mockResolvedValue({ targetCountry: "RU" })
    const text =
      "Добрый день, звоните на +7 967 197-60-80, моя почта client@example.com\n\nOn Tue, Nov 24, 2026 at 4:34 PM Jane <jane@acme.com> wrote:\n> цитата"
    const result = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text,
      channel: "smtp",
    })
    expect(result).toEqual({ phoneNumber: "+79671976080" })
    expect(mockSet).toHaveBeenCalledWith({ phoneNumber: "+79671976080" })
  })

  test("non-SMTP channel skips workspace own SMTP mailbox address", async () => {
    mockFindManyIntegrationSmtp.mockResolvedValue([
      { fromAddress: "sales@gkamion.ru", name: "GK Sales", auth: null },
    ])
    const resultOnlyOwn = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "please write to sales@gkamion.ru for info",
      channel: "telegram",
    })
    expect(resultOnlyOwn).toEqual({})
    expect(mockUpdate).not.toHaveBeenCalled()

    const resultBoth = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "forwarded from sales@gkamion.ru, my address is client@example.com",
      channel: "telegram",
    })
    expect(resultBoth).toEqual({ email: "client@example.com" })
    expect(mockSet).toHaveBeenCalledWith({ email: "client@example.com" })
  })

  test("graceful degradation when integrationSmtpModel.findMany throws — phone extraction still succeeds", async () => {
    mockFindManyIntegrationSmtp.mockRejectedValue(
      new Error("database connection timeout"),
    )
    const result = await updateContactFromMessage({
      contactId: "c1",
      workspaceId: "w1",
      text: "call me at 0912345678 or email client@example.com",
      channel: "telegram",
    })
    expect(result).toEqual({
      phoneNumber: "+84912345678",
      email: "client@example.com",
    })
    expect(mockSet).toHaveBeenCalledWith({
      phoneNumber: "+84912345678",
      email: "client@example.com",
    })
  })
})
