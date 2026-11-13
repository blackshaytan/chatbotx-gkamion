// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  fields: vi.fn(),
  update: vi.fn(),
  stored: vi.fn(),
  get: vi.fn(),
  search: vi.fn(),
  configured: vi.fn(),
  findLinkedCustomerId: vi.fn(),
  remember: vi.fn(),
}))
vi.mock("@chatbotx.io/business", () => ({
  contactService: { findByIdOrFail: mocks.find, update: mocks.update },
  contactCustomFieldService: { listWithDefinitions: mocks.fields },
  externalCrmService: {
    listOrdersForContact: mocks.stored,
    findLinkedCustomerId: mocks.findLinkedCustomerId,
  },
  readGkamionContactFields: (fields: { name: string; value: string }[]) => {
    const values = new Map(fields.map((field) => [field.name, field.value]))
    return {
      gkamionCustomerId: values.get("gkamion_customer_id") ?? null,
      gkamionVerified: values.get("gkamion_verified") ?? null,
    }
  },
}))
vi.mock("@chatbotx.io/logger", () => ({
  getChildLogger: () => ({ error: vi.fn(), warn: vi.fn() }),
}))
vi.mock("../src/features/contacts/lib/gkamion-cabinet", () => ({
  isGkamionCabinetConfigured: mocks.configured,
  gkamionAdminGet: mocks.get,
  searchGkamionCustomers: mocks.search,
  rememberGkamionOrderHistoryLink: mocks.remember,
  pickBestCustomer: (rows: { id: number }[]) =>
    rows.length === 1 ? rows[0] : undefined,
}))
const { listContactOrdersWithGkamion } = await import(
  "../src/features/contacts/lib/pull-gkamion-contact"
)
const input = { workspaceId: "1", contactId: "2" }
const baseContact = {
  id: "2",
  firstName: null,
  lastName: null,
  email: null,
  phoneNumber: null,
}
const customer = {
  id: 6733,
  name: "Владислав",
  family_name: "Минералов",
  email: "customer@example.com",
  contact: { phone: "+7 (999) 123-45-67" },
}
const stored = { externalOrderId: "stored" }

describe("gKamion contact profile enrichment", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.configured.mockReturnValue(true)
    mocks.findLinkedCustomerId.mockResolvedValue(null)
    mocks.find.mockResolvedValue({ ...baseContact })
    mocks.fields.mockResolvedValue([
      { name: "gkamion_customer_id", value: "6733" },
      { name: "gkamion_verified", value: "order_history" },
    ])
    mocks.stored.mockResolvedValue([stored])
    mocks.update.mockResolvedValue({})
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith("/customers/")) {
        return { customer }
      }
      if (path.startsWith("/order_status")) {
        return { order_status_types: [] }
      }
      return { orders: [] }
    })
  })
  test("fills empty phone, email and name for an order-history binding", async () => {
    const result = await listContactOrdersWithGkamion(input)
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.get).toHaveBeenCalledWith("/customers/6733")
    expect(mocks.update).toHaveBeenCalledWith(
      { workspaceId: "1", id: "2", accessScope: undefined },
      {
        firstName: "Владислав",
        lastName: "Минералов",
        email: "customer@example.com",
        phoneNumber: "+79991234567",
      },
    )
    expect(result.profile).toMatchObject({
      gkamionCustomerId: "6733",
      email: "customer@example.com",
      phoneNumber: "+79991234567",
      updated: true,
    })
  })
  test("preserves nonempty phone, email and name", async () => {
    mocks.find.mockResolvedValue({
      ...baseContact,
      firstName: "Своё имя",
      lastName: "Своя фамилия",
      email: "keep@example.com",
      phoneNumber: "+79998887766",
    })
    const result = await listContactOrdersWithGkamion(input)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(result.profile).toMatchObject({
      firstName: "Своё имя",
      email: "keep@example.com",
      phoneNumber: "+79998887766",
      updated: false,
    })
  })
  test("rejects linked customer ID mismatch without fallback or profile writes", async () => {
    mocks.find.mockResolvedValue({ ...baseContact, email: "other@example.com" })
    mocks.get.mockResolvedValue({ customer: { ...customer, id: 999 } })
    expect(await listContactOrdersWithGkamion(input)).toEqual({
      data: [stored],
    })
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  test("does not fall back when the verified linked customer is missing", async () => {
    mocks.find.mockResolvedValue({ ...baseContact, email: "other@example.com" })
    mocks.get.mockRejectedValue(new Error("gKamion customer HTTP 404"))
    expect(await listContactOrdersWithGkamion(input)).toEqual({
      data: [stored],
    })
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  test("does not send a malformed verified ID to the API", async () => {
    mocks.fields.mockResolvedValue([
      { name: "gkamion_customer_id", value: "../6733" },
      { name: "gkamion_verified", value: "order_history" },
    ])
    expect(await listContactOrdersWithGkamion(input)).toEqual({
      data: [stored],
    })
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  test("skips masked source phone and uses an available full cell phone", async () => {
    mocks.get.mockImplementation((path: string) =>
      path.startsWith("/customers/")
        ? {
            customer: {
              ...customer,
              contact: { phone: "+7***4567", cell_phone: "+7 (999) 123-45-68" },
            },
          }
        : { orders: [] },
    )
    const result = await listContactOrdersWithGkamion(input)
    expect(result.profile?.phoneNumber).toBe("+79991234568")
  })
  test("does not copy an invalid source phone", async () => {
    mocks.get.mockImplementation((path: string) =>
      path.startsWith("/customers/")
        ? { customer: { ...customer, contact: { phone: "+7***4567" } } }
        : { orders: [] },
    )
    const result = await listContactOrdersWithGkamion(input)
    expect(result.profile?.phoneNumber).toBeNull()
    expect(mocks.update.mock.calls[0]?.[1]).not.toHaveProperty("phoneNumber")
  })

  test("reads the customer stored on the order when phone and email belong to someone else", async () => {
    mocks.fields.mockResolvedValue([])
    mocks.find.mockResolvedValue({
      ...baseContact,
      firstName: "Денис Сергеевич",
      lastName: "Костевич",
      email: "cont@tkforsage.ru",
      phoneNumber: "+84169876366",
    })
    mocks.findLinkedCustomerId.mockResolvedValue("6945")
    mocks.get.mockImplementation((path: string) => {
      if (path === "/customers/6945") {
        return { customer: { ...customer, id: 6945 } }
      }
      if (path.startsWith("/order_status")) {
        return { order_status_types: [] }
      }
      return { orders: [] }
    })
    const result = await listContactOrdersWithGkamion(input)
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.remember).toHaveBeenCalledWith({
      workspaceId: "1",
      contactId: "2",
      customerId: "6945",
    })
    expect(result.profile?.gkamionCustomerId).toBe("6945")
  })

  test("does not search by email when the stored order customer is missing", async () => {
    mocks.fields.mockResolvedValue([])
    mocks.find.mockResolvedValue({
      ...baseContact,
      email: "cont@tkforsage.ru",
      phoneNumber: "+84169876366",
    })
    mocks.findLinkedCustomerId.mockResolvedValue("6945")
    mocks.get.mockRejectedValue(
      new Error("gKamion /customers/6945 failed: HTTP 404"),
    )
    expect(await listContactOrdersWithGkamion(input)).toEqual({
      data: [stored],
    })
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.remember).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("does not search by a masked stored phone with ten visible digits", async () => {
    mocks.fields.mockResolvedValue([])
    mocks.find.mockResolvedValue({
      ...baseContact,
      phoneNumber: "+7 (999) *** 1234567",
    })
    mocks.search.mockResolvedValue([customer])
    expect(await listContactOrdersWithGkamion(input)).toEqual({
      data: [stored],
    })
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test.each([
    true,
    false,
  ])("denied contact cannot read stored orders even when configured=%s", async (configured) => {
    mocks.configured.mockReturnValue(configured)
    mocks.find.mockRejectedValue(new Error("access denied"))
    await expect(listContactOrdersWithGkamion(input)).rejects.toThrow(
      "access denied",
    )
    expect(mocks.stored).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  test.each([
    "0000000000",
    "+01234567890",
    "+11111111111",
  ])("invalid source phone %s falls back only to a valid cell phone", async (phone) => {
    mocks.get.mockImplementation((path: string) =>
      path.startsWith("/customers/")
        ? {
            customer: {
              ...customer,
              contact: { phone, cell_phone: "+79991234568" },
            },
          }
        : { orders: [] },
    )
    const result = await listContactOrdersWithGkamion(input)
    expect(result.profile?.phoneNumber).toBe("+79991234568")
  })
})
