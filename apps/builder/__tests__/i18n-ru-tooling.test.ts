// @vitest-environment node
import { describe, expect, test } from "vitest"
import en from "../messages/en.json"
import {
  buildCatalogLike,
  flattenCatalog,
  listPendingKeys,
  mergeTranslations,
} from "../scripts/i18n/catalog"
import { ruBatches } from "../scripts/i18n/ru-batches"

const english = { a: { x: "Hello {name}", y: "Save" }, b: { z: "Telegram" } }
const flatEnglish = flattenCatalog(english)

describe("i18n catalog helpers", () => {
  test("flattens and rebuilds in English key order", () => {
    const rebuilt = buildCatalogLike(english, {
      "b.z": "Telegram",
      "a.y": "Сохранить",
    })
    expect(JSON.stringify(rebuilt)).toBe(
      JSON.stringify({ a: { y: "Сохранить" }, b: { z: "Telegram" } }),
    )
  })

  test("lists untranslated keys of the requested sections only", () => {
    const pending = listPendingKeys({
      english: flatEnglish,
      target: { ...flatEnglish, "a.y": "Сохранить" },
      sameAsEnglish: new Set(["b.z"]),
      sections: ["a", "b"],
    })
    expect(pending).toEqual(["a.x"])
  })

  test("rejects unknown keys, empty values and changed placeholders", () => {
    const result = mergeTranslations({
      english: flatEnglish,
      target: flatEnglish,
      sameAsEnglish: [],
      translations: { "a.x": "Привет {user}", "a.y": " ", "c.q": "?" },
    })
    expect(result.errors).toHaveLength(3)
  })

  test("records identical translations in the same-as-English list", () => {
    const result = mergeTranslations({
      english: flatEnglish,
      target: flatEnglish,
      sameAsEnglish: [],
      translations: { "a.x": "Привет, {name}", "b.z": "Telegram" },
    })
    expect(result.errors).toEqual([])
    expect(result.target["a.x"]).toBe("Привет, {name}")
    expect(result.sameAsEnglish).toEqual(["b.z"])
  })
})

describe("ru batches", () => {
  test("cover every top-level section exactly once", () => {
    const assigned: string[] = Object.values(ruBatches).flat()
    expect([...assigned].sort()).toEqual(Object.keys(en).sort())
  })
})
