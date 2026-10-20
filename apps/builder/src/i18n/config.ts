export const locales = [
  "ar",
  "az",
  "da",
  "de",
  "en",
  "es",
  "fi",
  "fr",
  "he",
  "id",
  "it",
  "ja",
  "nl",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sv",
  "tr",
  "vi",
  "zh-CN",
  "zh-TW",
] as const

export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = "en"

export const localeMeta: Record<
  Locale,
  { nativeLabel: string; dir: "ltr" | "rtl" }
> = {
  ar: { nativeLabel: "العربية", dir: "rtl" },
  az: { nativeLabel: "Azərbaycanca", dir: "ltr" },
  da: { nativeLabel: "Dansk", dir: "ltr" },
  de: { nativeLabel: "Deutsch", dir: "ltr" },
  en: { nativeLabel: "English", dir: "ltr" },
  es: { nativeLabel: "Español", dir: "ltr" },
  fi: { nativeLabel: "Suomi", dir: "ltr" },
  fr: { nativeLabel: "Français", dir: "ltr" },
  he: { nativeLabel: "עברית", dir: "rtl" },
  id: { nativeLabel: "Bahasa Indonesia", dir: "ltr" },
  it: { nativeLabel: "Italiano", dir: "ltr" },
  ja: { nativeLabel: "日本語", dir: "ltr" },
  nl: { nativeLabel: "Nederlands", dir: "ltr" },
  "pt-BR": { nativeLabel: "Português (Brasil)", dir: "ltr" },
  "pt-PT": { nativeLabel: "Português (Portugal)", dir: "ltr" },
  ro: { nativeLabel: "Română", dir: "ltr" },
  ru: { nativeLabel: "Русский", dir: "ltr" },
  sv: { nativeLabel: "Svenska", dir: "ltr" },
  tr: { nativeLabel: "Türkçe", dir: "ltr" },
  vi: { nativeLabel: "Tiếng Việt", dir: "ltr" },
  "zh-CN": { nativeLabel: "简体中文", dir: "ltr" },
  "zh-TW": { nativeLabel: "繁體中文", dir: "ltr" },
}

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value)
}

function matchesLocaleTag(normalizedValue: string, localeTag: string) {
  return (
    normalizedValue === localeTag || normalizedValue.startsWith(`${localeTag}-`)
  )
}

export function resolveLocale(value: string | undefined): Locale {
  if (!value) {
    return defaultLocale
  }

  const normalizedValue = value.trim()
  if (isLocale(normalizedValue)) {
    return normalizedValue
  }

  const normalizedLower = normalizedValue.toLowerCase()
  const language = normalizedLower.split("-")[0]
  if (!language) {
    return defaultLocale
  }
  if (language === "pt") {
    return "pt-BR"
  }
  if (
    ["zh-hant", "zh-hk", "zh-mo", "zh-tw"].some((localeTag) =>
      matchesLocaleTag(normalizedLower, localeTag),
    )
  ) {
    return "zh-TW"
  }
  if (
    ["zh-cn", "zh-hans"].some((localeTag) =>
      matchesLocaleTag(normalizedLower, localeTag),
    )
  ) {
    return "zh-CN"
  }
  if (language === "zh") {
    return "zh-CN"
  }

  return (
    locales.find((locale) => locale.toLowerCase().split("-")[0] === language) ??
    defaultLocale
  )
}

const parseAcceptLanguage = (header: string) =>
  header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";")
      const qualityParam = params.find((param) => param.trim().startsWith("q="))
      const quality = qualityParam ? Number(qualityParam.trim().slice(2)) : 1
      return { tag: tag.trim(), quality: Number.isNaN(quality) ? 0 : quality }
    })
    .filter(({ tag, quality }) => tag !== "" && tag !== "*" && quality > 0)
    .sort((left, right) => right.quality - left.quality)

const isEnglishTag = (tag: string) => tag.toLowerCase().split("-")[0] === "en"

export const pickAcceptLanguageLocale = (
  header: string | null | undefined,
): Locale | undefined => {
  if (!header) {
    return
  }
  for (const { tag } of parseAcceptLanguage(header)) {
    const locale = resolveLocale(tag)
    if (locale !== defaultLocale || isEnglishTag(tag)) {
      return locale
    }
  }
}
