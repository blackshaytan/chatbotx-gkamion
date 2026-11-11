// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({ find: vi.fn(), fields: vi.fn() }))
vi.mock("@chatbotx.io/business", () => ({
  contactService: { findByIdOrFail: mocks.find },
  contactCustomFieldService: { listWithDefinitions: mocks.fields },
  readGkamionContactFields: (fields: { name: string; value: string }[]) => {
    const values = new Map(fields.map((field) => [field.name, field.value]))
    return {
      gkamionCustomerId: values.get("gkamion_customer_id") ?? null,
      gkamionVerified: values.get("gkamion_verified") ?? null,
    }
  },
}))
vi.mock("@chatbotx.io/logger", () => ({
  getChildLogger: () => ({ error: vi.fn() }),
}))
const { resolveGkamionCabinetLinkForContact, pickBestCustomer } = await import(
  "../src/features/contacts/lib/gkamion-cabinet"
)
const input = { workspaceId: "1", contactId: "2" }
const linked = (id: string, method = "order_history") => [
  { name: "gkamion_customer_id", value: id },
  { name: "gkamion_verified", value: method },
]
const response = (body: unknown) => ({ ok: true, json: async () => body })

describe("verified gKamion cabinet links", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv("GKAMION_BASE_URL", "https://admin.example.test/api/v3")
    vi.stubEnv("GKAMION_USERNAME", "test-user")
    vi.stubEnv("GKAMION_PASSWORD", "test-password")
    vi.stubEnv("GKAMION_CABINET_URL", "https://admin.example.test")
    mocks.find.mockResolvedValue({ id: "2", email: null, phoneNumber: null })
    mocks.fields.mockResolvedValue([])
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  test.each([
    "phone",
    "email",
    "order_history",
  ])("opens verified %s binding without phone/email", async (method) => {
    mocks.fields.mockResolvedValue(linked("6733", method))
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ customer: { id: 6733 } }))
    vi.stubGlobal("fetch", fetcher)
    expect(await resolveGkamionCabinetLinkForContact(input)).toEqual({
      status: "ok",
      customerId: "6733",
      url: "https://admin.example.test/customers/6733",
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://admin.example.test/api/v3/customers/6733",
    )
    expect(mocks.fields).toHaveBeenCalledWith({ contactId: "2" })
  })

  test("checks contact access before reading binding fields", async () => {
    const scope = { ownerId: "member" } as unknown as NonNullable<
      Parameters<typeof resolveGkamionCabinetLinkForContact>[0]["accessScope"]
    >
    mocks.find.mockRejectedValue(new Error("access denied"))
    await expect(
      resolveGkamionCabinetLinkForContact({ ...input, accessScope: scope }),
    ).rejects.toThrow("access denied")
    expect(mocks.find).toHaveBeenCalledWith({
      workspaceId: "1",
      id: "2",
      accessScope: scope,
    })
    expect(mocks.fields).not.toHaveBeenCalled()
  })

  test("rejects an ID mismatch instead of opening another customer", async () => {
    mocks.fields.mockResolvedValue(linked("6733"))
    mocks.find.mockResolvedValue({
      id: "2",
      email: "other@example.com",
      phoneNumber: null,
    })
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ customer: { id: 999 } }))
    vi.stubGlobal("fetch", fetcher)
    expect(await resolveGkamionCabinetLinkForContact(input)).toEqual({
      status: "not_found",
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain("search_word")
  })

  test("a missing bound customer does not fall back to another email", async () => {
    mocks.fields.mockResolvedValue(linked("6733"))
    mocks.find.mockResolvedValue({
      id: "2",
      email: "other@example.com",
      phoneNumber: null,
    })
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    vi.stubGlobal("fetch", fetcher)
    expect(await resolveGkamionCabinetLinkForContact(input)).toEqual({
      status: "not_found",
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test.each([
    "../6733",
    "0",
    "-1",
    "6733.5",
    "6733x",
  ])("rejects malformed verified id %s before fetch", async (id) => {
    mocks.fields.mockResolvedValue(linked(id))
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    expect(await resolveGkamionCabinetLinkForContact(input)).toEqual({
      status: "not_found",
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  test("does not trust an unknown verification marker", async () => {
    mocks.fields.mockResolvedValue(linked("6733", "claimed"))
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    expect(await resolveGkamionCabinetLinkForContact(input)).toEqual({
      status: "unavailable",
      reason: "missing_identifiers",
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  test("unbound email fallback remains exact", async () => {
    mocks.find.mockResolvedValue({
      id: "2",
      email: "ada@example.com",
      phoneNumber: null,
    })
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({ customers: [{ id: 6733, email: "ada@example.com" }] }),
      )
    vi.stubGlobal("fetch", fetcher)
    expect(await resolveGkamionCabinetLinkForContact(input)).toMatchObject({
      status: "ok",
      customerId: "6733",
    })
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "search_word=ada%40example.com",
    )
  })

  test("does not choose an arbitrary nonmatching search result", () => {
    expect(
      pickBestCustomer([{ id: 10, email: "other@example.com" }], {
        email: "ada@example.com",
      }),
    ).toBeUndefined()
  })
  test("does not choose the first of several exact matches", () => {
    expect(
      pickBestCustomer(
        [
          { id: 10, email: "ada@example.com" },
          { id: 11, email: "ada@example.com" },
        ],
        { email: "ada@example.com" },
      ),
    ).toBeUndefined()
  })
  test("does not match a phone suffix against a shorter number", () => {
    expect(
      pickBestCustomer([{ id: 10, contact: { phone: "12345" } }], {
        phoneDigits: "7999912345",
      }),
    ).toBeUndefined()
  })

  test("rejects masked stored phone even with ten visible digits", async () => {
    mocks.find.mockResolvedValue({
      id: "2",
      email: null,
      phoneNumber: "+7 (999) *** 1234567",
    })
    const fetcher = vi.fn().mockResolvedValue(
      response({
        customers: [{ id: 6733, contact: { phone: "+79991234567" } }],
      }),
    )
    vi.stubGlobal("fetch", fetcher)
    expect(await resolveGkamionCabinetLinkForContact(input)).toEqual({
      status: "unavailable",
      reason: "missing_identifiers",
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
  test("masked stored phone still permits a unique exact email fallback", async () => {
    mocks.find.mockResolvedValue({
      id: "2",
      email: "ada@example.com",
      phoneNumber: "+7 (999) *** 1234567",
    })
    const fetcher = vi.fn().mockResolvedValue(
      response({
        customers: [
          {
            id: 6733,
            email: "ada@example.com",
            contact: { phone: "+79881112233" },
          },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetcher)
    expect(await resolveGkamionCabinetLinkForContact(input)).toMatchObject({
      status: "ok",
      customerId: "6733",
    })
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "search_word=ada%40example.com",
    )
  })
})
