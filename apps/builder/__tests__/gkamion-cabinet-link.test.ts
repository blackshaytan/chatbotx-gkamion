// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findByIdOrFail: vi.fn(),
}))

vi.mock("@chatbotx.io/business", () => ({
  contactService: {
    findByIdOrFail: mocks.findByIdOrFail,
  },
}))

vi.mock("@chatbotx.io/logger", () => ({
  getChildLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}))

const { resolveGkamionCabinetLinkForContact } = await import(
  "../src/features/contacts/lib/gkamion-cabinet"
)

describe("resolveGkamionCabinetLinkForContact", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    process.env.GKAMION_BASE_URL = "https://admin.gkamion.ru/api/v3"
    process.env.GKAMION_USERNAME = "user"
    process.env.GKAMION_PASSWORD = "pass"
    process.env.GKAMION_CABINET_URL = "https://admin.gkamion.ru"
  })

  test("returns unavailable when credentials are missing", async () => {
    delete process.env.GKAMION_BASE_URL
    await expect(
      resolveGkamionCabinetLinkForContact({
        workspaceId: "1",
        contactId: "2",
      }),
    ).resolves.toEqual({ status: "unavailable", reason: "not_configured" })
    expect(mocks.findByIdOrFail).not.toHaveBeenCalled()
  })

  test("returns unavailable when the contact has no phone or email", async () => {
    mocks.findByIdOrFail.mockResolvedValue({
      id: "2",
      email: null,
      phoneNumber: null,
    })

    await expect(
      resolveGkamionCabinetLinkForContact({
        workspaceId: "1",
        contactId: "2",
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "missing_identifiers",
    })
  })

  test("returns the cabinet URL for a phone match", async () => {
    mocks.findByIdOrFail.mockResolvedValue({
      id: "2",
      email: null,
      phoneNumber: "+7 (982) 819-75-25",
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        customers: [
          {
            id: 6032,
            email: "a@b.c",
            contact: { cell_phone: "+7 (982) 819-75-25" },
          },
        ],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      resolveGkamionCabinetLinkForContact({
        workspaceId: "1",
        contactId: "2",
      }),
    ).resolves.toEqual({
      status: "ok",
      customerId: "6032",
      url: "https://admin.gkamion.ru/customers/6032",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requested = String(fetchMock.mock.calls[0]?.[0])
    expect(requested).toContain("search_word=79828197525")
  })

  test("returns not_found when the admin API has no match", async () => {
    mocks.findByIdOrFail.mockResolvedValue({
      id: "2",
      email: "nobody@example.com",
      phoneNumber: null,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ customers: [] }),
      }),
    )

    await expect(
      resolveGkamionCabinetLinkForContact({
        workspaceId: "1",
        contactId: "2",
      }),
    ).resolves.toEqual({ status: "not_found" })
  })
})
