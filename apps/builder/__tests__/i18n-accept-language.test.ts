// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"
import { pickAcceptLanguageLocale, resolveLocale } from "@/i18n/config"
import { getUserLocale } from "@/lib/locale"

const requestState = vi.hoisted(() => ({
  cookieLocale: undefined as string | undefined,
  acceptLanguage: null as string | null,
}))

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () =>
        requestState.cookieLocale === undefined
          ? undefined
          : { value: requestState.cookieLocale },
    }),
  headers: () => Promise.resolve({ get: () => requestState.acceptLanguage }),
}))

describe("getUserLocale", () => {
  beforeEach(() => {
    requestState.cookieLocale = undefined
    requestState.acceptLanguage = null
  })

  test("prefers the saved cookie over the browser language", async () => {
    requestState.cookieLocale = "en"
    requestState.acceptLanguage = "ru-RU,ru;q=0.9"
    await expect(getUserLocale()).resolves.toBe("en")
  })

  test("uses the browser language when no cookie is saved", async () => {
    requestState.acceptLanguage = "ru-RU,ru;q=0.9"
    await expect(getUserLocale()).resolves.toBe("ru")
  })

  test("falls back to English without cookie or supported language", async () => {
    requestState.acceptLanguage = "xx"
    await expect(getUserLocale()).resolves.toBe("en")
  })
})

describe("ru locale resolution", () => {
  test("resolves regional Russian tags to ru", () => {
    expect(resolveLocale("ru-RU")).toBe("ru")
    expect(resolveLocale("ru")).toBe("ru")
  })
})

describe("pickAcceptLanguageLocale", () => {
  test("picks the highest-quality supported language", () => {
    expect(pickAcceptLanguageLocale("ru-RU,ru;q=0.9,en-US;q=0.8")).toBe("ru")
    expect(pickAcceptLanguageLocale("en-US;q=0.5,ru;q=0.9")).toBe("ru")
  })

  test("skips unsupported languages and wildcards", () => {
    expect(pickAcceptLanguageLocale("xx-YY,*;q=0.5,ru;q=0.1")).toBe("ru")
  })

  test("keeps English when the browser prefers it", () => {
    expect(pickAcceptLanguageLocale("en-GB,ru;q=0.8")).toBe("en")
  })

  test("returns undefined when nothing matches", () => {
    expect(pickAcceptLanguageLocale("xx,yy;q=0.4")).toBeUndefined()
    expect(pickAcceptLanguageLocale(null)).toBeUndefined()
    expect(pickAcceptLanguageLocale("")).toBeUndefined()
  })
})
