import { describe, expect, test } from "vitest"
import { syncExternalCustomerPublicRequest } from "../public"

describe("syncExternalCustomerPublicRequest", () => {
  test("keeps the documented customer payload", () => {
    const result = syncExternalCustomerPublicRequest.safeParse({
      customer: {
        externalCustomerId: "12345",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "Ada@Example.com",
        phoneNumber: "+79990000000",
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }
    expect(result.data.customer).toEqual({
      externalCustomerId: "12345",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phoneNumber: "+79990000000",
    })
  })

  test("maps a GKamion customer record and drops account secrets", () => {
    const result = syncExternalCustomerPublicRequest.safeParse({
      customer: {
        id: 42,
        name: "Иван",
        family_name: "Иванов",
        second_name: "Иванович",
        email: "ivan@example.com",
        crypted_password: "secret",
        password_salt: "salt",
        persistence_token: "token",
        contact: {
          phone: "79990000000",
          clean_phone: "79990000000",
          cell_phone: "+7 (999) 000-00-01",
          clean_cell_phone: "79990000001",
          email: null,
        },
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }
    expect(result.data).toEqual({
      customer: {
        externalCustomerId: "42",
        firstName: "Иван Иванович",
        lastName: "Иванов",
        email: "ivan@example.com",
        phoneNumber: "79990000001",
      },
    })
  })

  test("splits a full name when the surname field is a placeholder", () => {
    const result = syncExternalCustomerPublicRequest.safeParse({
      customer: {
        id: 7,
        name: "Гераскин Ростислав Петрович",
        family_name: "####",
        second_name: "####",
        email: "rostislav@example.com",
        contact: { clean_cell_phone: "", clean_phone: "79991112233" },
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }
    expect(result.data.customer.firstName).toBe("Ростислав Петрович")
    expect(result.data.customer.lastName).toBe("Гераскин")
    expect(result.data.customer.phoneNumber).toBe("79991112233")
  })

  test("drops placeholder labels and still accepts an email", () => {
    const result = syncExternalCustomerPublicRequest.safeParse({
      customer: {
        id: 8,
        name: "Клиент",
        family_name: "Покупатель",
        email: "client@example.com",
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }
    expect(result.data.customer.firstName).toBeUndefined()
    expect(result.data.customer.lastName).toBeUndefined()
    expect(result.data.customer.email).toBe("client@example.com")
  })
})
