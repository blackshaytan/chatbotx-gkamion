import { describe, expect, test } from "vitest"
import {
  getLanguageDisplayName,
  localizeLanguageOptions,
  toLanguageTag,
} from "@/lib/language-names"

describe("language names", () => {
  test("converts Meta language codes to BCP 47 tags", () => {
    expect(toLanguageTag("ar_EG")).toBe("ar-EG")
    expect(toLanguageTag("zh_Hant_HK")).toBe("zh-Hant-HK")
    expect(toLanguageTag("ru")).toBe("ru")
  })

  test("keeps the original English labels for English locales", () => {
    expect(getLanguageDisplayName("ar_EG", "en", "Arabic (EGY)")).toBe(
      "Arabic (EGY)",
    )
  })

  test("names languages in the interface language", () => {
    expect(getLanguageDisplayName("ru", "ru", "Russian")).toBe("Русский")
    expect(getLanguageDisplayName("ar_EG", "ru", "Arabic (EGY)")).toBe(
      "Арабский (Египет)",
    )
  })

  test("falls back to the original label for unknown or invalid codes", () => {
    expect(getLanguageDisplayName("not a code", "ru", "Custom")).toBe("Custom")
  })

  test("localizes every option and keeps its value", () => {
    expect(
      localizeLanguageOptions(
        [
          { label: "German", value: "de" },
          { label: "English (US)", value: "en_US" },
        ],
        "ru",
      ),
    ).toEqual([
      { label: "Немецкий", value: "de" },
      { label: "Английский (Соединенные Штаты)", value: "en_US" },
    ])
  })
})
