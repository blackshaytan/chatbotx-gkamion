import { describe, expect, test } from "vitest"
import {
  matchingContacts,
  normalizeEmail,
  phoneCandidates,
  pickSurvivor,
  type SameClientIdentity,
} from "../src/contact/merge-same-client-rules"

const contact = (
  id: string,
  createdAt: string,
  phoneNumber: string | null,
  email: string | null = null,
): SameClientIdentity => ({
  id,
  createdAt: new Date(createdAt),
  phoneNumber,
  email,
})

describe("pickSurvivor", () => {
  test("keeps the older contact", () => {
    const older = contact("2", "2026-11-06T19:14:40Z", "+100")
    const newer = contact("9", "2026-11-06T20:15:25Z", "+100")
    expect(pickSurvivor([newer, older]).id).toBe("2")
  })

  test("breaks a timestamp tie on the smaller id", () => {
    const at = "2026-11-06T19:14:40Z"
    expect(
      pickSurvivor([contact("20", at, "+100"), contact("3", at, "+100")]).id,
    ).toBe("3")
  })
})

describe("matchingContacts", () => {
  const max = contact(
    "max",
    "2026-11-06T19:14:40Z",
    "+79261546770",
    "avtomoll.rafael@gmail.com",
  )
  const zzap = contact(
    "zzap",
    "2026-11-06T20:15:25Z",
    "+79261546770",
    "avtomoll.rafael@gmail.com",
  )
  const stranger = contact(
    "other",
    "2026-11-06T18:00:00Z",
    "+100",
    "other@example.com",
  )

  test("matches the shared phone and ignores a different email", () => {
    expect(
      matchingContacts([max, zzap, stranger], {
        phoneNumber: "+79261546770",
        email: "other@example.com",
      }).map((row) => row.id),
    ).toEqual(["max", "zzap"])
  })

  test("uses email only when the phone matches nobody", () => {
    expect(
      matchingContacts([max, stranger], {
        phoneNumber: "+79990000000",
        email: "Avtomoll.Rafael@gmail.com",
      }).map((row) => row.id),
    ).toEqual(["max"])
  })

  test("matches a raw phone that normalizes to the stored number", () => {
    expect(phoneCandidates("79261546770")).toContain("+79261546770")
    expect(normalizeEmail("  Avtomoll.Rafael@gmail.com ")).toBe(
      "avtomoll.rafael@gmail.com",
    )
  })
})
