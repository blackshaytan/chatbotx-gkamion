// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  fallbackStatusLabels,
  mapGkamionOrders,
  usableEmail,
  usablePersonName,
} from "../src/features/contacts/lib/gkamion-orders"

const mocks = vi.hoisted(() => ({
  findByIdOrFail: vi.fn(),
  update: vi.fn(),
  listWithDefinitions: vi.fn(),
  listOrdersForContact: vi.fn(),
  isConfigured: vi.fn(),
  adminGet: vi.fn(),
  searchCustomers: vi.fn(),
}))

vi.mock("@chatbotx.io/business", () => ({
  contactService: {
    findByIdOrFail: mocks.findByIdOrFail,
    update: mocks.update,
  },
  contactCustomFieldService: {
    listWithDefinitions: mocks.listWithDefinitions,
  },
  externalCrmService: {
    listOrdersForContact: mocks.listOrdersForContact,
    findLinkedCustomerId: async () => null,
  },
  readGkamionContactFields: (fields: { name: string; value: string }[]) => {
    const byName = new Map(fields.map((field) => [field.name, field.value]))
    const customerId = byName.get("gkamion_customer_id")?.trim() || null
    const verified = byName.get("gkamion_verified")?.trim() || null
    return { gkamionCustomerId: customerId, gkamionVerified: verified }
  },
}))

vi.mock("@chatbotx.io/logger", () => ({
  getChildLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}))

vi.mock("../src/features/contacts/lib/gkamion-cabinet", () => ({
  isGkamionCabinetConfigured: mocks.isConfigured,
  gkamionAdminGet: mocks.adminGet,
  searchGkamionCustomers: mocks.searchCustomers,
  pickBestCustomer: (customers: { id?: number | string }[]) => customers[0],
}))

const { listContactOrdersWithGkamion } = await import(
  "../src/features/contacts/lib/pull-gkamion-contact"
)

const storedOrder = {
  externalOrderId: "stored",
  externalCustomerId: "27",
  status: "ready",
  lastEventAt: new Date("2026-11-01T00:00:00.000Z"),
}

describe("mapGkamionOrders", () => {
  const labels = fallbackStatusLabels()

  test("keeps an open order and hides an issued one", () => {
    const orders = mapGkamionOrders(
      [
        {
          id: 21_435,
          customer_id: 27,
          updated_at: "2026-11-06T21:27:20.397+03:00",
          delivery_type: "Самовывоз",
          payment_type: { payment_type: { name: "Наличные" } },
          order_items: [
            {
              status_id: 25,
              make_name: "GANZ",
              detail_name: "Аккумулятор",
              cost: 9777,
              qnt: 1,
            },
          ],
        },
        {
          id: 21_646,
          customer_id: 27,
          updated_at: "2026-11-06T21:24:40.320+03:00",
          order_items: [{ status_id: 8, cost: 966, qnt: 4 }],
        },
      ],
      "27",
      labels,
    )

    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({
      externalOrderId: "21435",
      externalCustomerId: "27",
      status: "Самовывоз -> Хранение",
      amount: 9777,
      currency: "RUB",
      paymentStatus: "Наличные",
      deliveryMethod: "Самовывоз",
      itemSummary: "GANZ Аккумулятор",
    })
  })

  test("uses one status when open lines differ", () => {
    const orders = mapGkamionOrders(
      [
        {
          id: 1,
          order_items: [
            { status_id: 16, detail_name: "Крышка", cost: 10, qnt: 1 },
            { status_id: 13, detail_name: "Болт", cost: 5, qnt: 2 },
            { status_id: 8, detail_name: "Скрыто", cost: 99, qnt: 1 },
          ],
        },
      ],
      "27",
      labels,
    )

    expect(orders[0]?.status).toBe("Разные статусы")
    expect(orders[0]?.amount).toBe(20)
    expect(orders[0]?.itemSummary).toBe("Крышка; Болт")
  })

  test("uses open-line updated_at so status changes are not lagged by order header", () => {
    const orders = mapGkamionOrders(
      [
        {
          id: 25_188,
          customer_id: 1017,
          created_at: "2026-11-19T17:54:32.865+03:00",
          updated_at: "2026-11-24T10:48:00.000+03:00",
          order_items: [
            {
              status_id: 16,
              detail_name: "Регулятор давления",
              make_name: "LADA",
              cost: 1511,
              qnt: 1,
              updated_at: "2026-11-24T09:43:28.030+03:00",
            },
          ],
        },
      ],
      "1017",
      labels,
    )

    expect(orders).toHaveLength(1)
    expect(orders[0]?.status).toBe("Поступил в пункт выдачи")
    expect(orders[0]?.lastEventAt).toEqual(
      new Date("2026-11-24T09:43:28.030+03:00"),
    )
  })

  test("falls back to order updated_at when open lines have no timestamp", () => {
    const orders = mapGkamionOrders(
      [
        {
          id: 2,
          updated_at: "2026-11-06T21:27:20.397+03:00",
          order_items: [{ status_id: 16, cost: 10, qnt: 1 }],
        },
      ],
      "27",
      labels,
    )

    expect(orders[0]?.lastEventAt).toEqual(
      new Date("2026-11-06T21:27:20.397+03:00"),
    )
  })

  test("picks the newest open-line updated_at across mixed lines", () => {
    const orders = mapGkamionOrders(
      [
        {
          id: 3,
          updated_at: "2026-11-01T00:00:00.000+03:00",
          order_items: [
            {
              status_id: 16,
              cost: 10,
              qnt: 1,
              updated_at: "2026-11-24T09:00:00.000+03:00",
            },
            {
              status_id: 13,
              cost: 5,
              qnt: 1,
              updated_at: "2026-11-24T09:50:00.000+03:00",
            },
            {
              status_id: 8,
              cost: 99,
              qnt: 1,
              updated_at: "2026-11-24T12:00:00.000+03:00",
            },
          ],
        },
      ],
      "27",
      labels,
    )

    expect(orders[0]?.lastEventAt).toEqual(
      new Date("2026-11-24T09:50:00.000+03:00"),
    )
  })

  test("ignores invalid open-line timestamps and null status lines", () => {
    const orders = mapGkamionOrders(
      [
        {
          id: 4,
          updated_at: "2026-11-06T21:27:20.397+03:00",
          order_items: [
            {
              status_id: 16,
              cost: 10,
              qnt: 1,
              updated_at: "not-a-date",
            },
            {
              status_id: null,
              cost: 1,
              qnt: 1,
              updated_at: "2026-11-24T12:00:00.000+03:00",
            },
            {
              status_id: 16,
              cost: 5,
              qnt: 1,
              updated_at: "2026-11-24T09:43:28.030+03:00",
            },
          ],
        },
      ],
      "27",
      labels,
    )

    expect(orders[0]?.lastEventAt).toEqual(
      new Date("2026-11-24T09:43:28.030+03:00"),
    )
  })

  test("falls back to order created_at when no updated_at is present", () => {
    const orders = mapGkamionOrders(
      [
        {
          id: 5,
          created_at: "2026-11-19T17:54:32.865+03:00",
          order_items: [{ status_id: 16, cost: 10, qnt: 1 }],
        },
      ],
      "27",
      labels,
    )

    expect(orders[0]?.lastEventAt).toEqual(
      new Date("2026-11-19T17:54:32.865+03:00"),
    )
  })

  test("drops placeholder names and broken emails", () => {
    expect(usablePersonName("Клиент")).toBeNull()
    expect(usablePersonName("####")).toBeNull()
    expect(usablePersonName(" Ахметжанов ")).toBe("Ахметжанов")
    expect(usableEmail("not-an-email")).toBeNull()
    expect(usableEmail("ada@example.com")).toBe("ada@example.com")
  })
})

describe("listContactOrdersWithGkamion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listOrdersForContact.mockResolvedValue([storedOrder])
    mocks.update.mockResolvedValue({})
  })

  test("returns stored snapshots when gKamion is not configured", async () => {
    mocks.isConfigured.mockReturnValue(false)

    await expect(
      listContactOrdersWithGkamion({ workspaceId: "1", contactId: "2" }),
    ).resolves.toEqual({ data: [storedOrder] })
    expect(mocks.findByIdOrFail).toHaveBeenCalledWith({
      workspaceId: "1",
      id: "2",
      accessScope: undefined,
    })
  })

  test("fills an empty surname and email from the verified customer", async () => {
    mocks.isConfigured.mockReturnValue(true)
    mocks.findByIdOrFail.mockResolvedValue({
      id: "2",
      firstName: "Рафаэль",
      lastName: null,
      email: null,
      phoneNumber: "+79261546770",
    })
    mocks.listWithDefinitions.mockResolvedValue([
      { name: "gkamion_customer_id", value: "27" },
      { name: "gkamion_verified", value: "phone" },
    ])
    mocks.adminGet.mockImplementation((path: string) => {
      if (path.startsWith("/customers/")) {
        return {
          customer: {
            id: 27,
            name: "Рафаэль",
            family_name: "Ахметжанов",
            email: "ada@example.com",
          },
        }
      }
      if (path.startsWith("/order_status_types")) {
        return { order_status_types: [] }
      }
      return {
        orders: [
          {
            id: 21_435,
            customer_id: 27,
            updated_at: "2026-11-06T21:27:20.397+03:00",
            delivery_type: "Самовывоз",
            order_items: [
              {
                status_id: 25,
                make_name: "GANZ",
                detail_name: "Аккумулятор",
                cost: 9777,
                qnt: 1,
              },
            ],
          },
        ],
      }
    })

    const result = await listContactOrdersWithGkamion({
      workspaceId: "1",
      contactId: "2",
    })

    expect(mocks.searchCustomers).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(
      { workspaceId: "1", id: "2", accessScope: undefined },
      { lastName: "Ахметжанов", email: "ada@example.com" },
    )
    expect(result.profile).toMatchObject({
      firstName: "Рафаэль",
      lastName: "Ахметжанов",
      email: "ada@example.com",
      gkamionCustomerId: "27",
      updated: true,
      fullName: "Рафаэль Ахметжанов",
    })
    expect(result.data[0]?.externalOrderId).toBe("21435")
  })

  test("does not overwrite a surname that is already set", async () => {
    mocks.isConfigured.mockReturnValue(true)
    mocks.findByIdOrFail.mockResolvedValue({
      id: "2",
      firstName: "Рафаэль",
      lastName: "Своя",
      email: "kept@example.com",
      phoneNumber: "+79261546770",
    })
    mocks.listWithDefinitions.mockResolvedValue([
      { name: "gkamion_customer_id", value: "27" },
      { name: "gkamion_verified", value: "phone" },
    ])
    mocks.adminGet.mockImplementation((path: string) => {
      if (path.startsWith("/customers/")) {
        return {
          id: 27,
          name: "Рафаэль",
          family_name: "Ахметжанов",
          email: "ada@example.com",
        }
      }
      if (path.startsWith("/order_status_types")) {
        return { order_status_types: [] }
      }
      return { orders: [] }
    })

    const result = await listContactOrdersWithGkamion({
      workspaceId: "1",
      contactId: "2",
    })

    expect(mocks.update).not.toHaveBeenCalled()
    expect(result.profile?.updated).toBe(false)
    expect(result.profile?.lastName).toBe("Своя")
    expect(result.profile?.email).toBe("kept@example.com")
  })

  test("falls back to stored snapshots when the admin API fails", async () => {
    mocks.isConfigured.mockReturnValue(true)
    mocks.findByIdOrFail.mockResolvedValue({
      id: "2",
      email: null,
      phoneNumber: null,
    })
    mocks.listWithDefinitions.mockResolvedValue([
      { name: "gkamion_customer_id", value: "27" },
      { name: "gkamion_verified", value: "phone" },
    ])
    mocks.adminGet.mockRejectedValue(new Error("down"))

    await expect(
      listContactOrdersWithGkamion({ workspaceId: "1", contactId: "2" }),
    ).resolves.toEqual({ data: [storedOrder] })
  })
})
