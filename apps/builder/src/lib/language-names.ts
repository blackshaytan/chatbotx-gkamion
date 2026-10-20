type LanguageOption = {
  label: string
  value: string
}

export const toLanguageTag = (code: string) => code.replaceAll("_", "-")

const capitalize = (text: string, locale: string) =>
  text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)

export const getLanguageDisplayName = (
  code: string,
  locale: string,
  fallback: string,
) => {
  if (locale === "en" || locale.startsWith("en-")) {
    return fallback
  }

  const tag = toLanguageTag(code)
  try {
    const name = new Intl.DisplayNames([locale], {
      type: "language",
      languageDisplay: "standard",
    }).of(tag)
    if (!name || name === tag) {
      return fallback
    }
    return capitalize(name, locale)
  } catch {
    return fallback
  }
}

export const localizeLanguageOptions = <TOption extends LanguageOption>(
  options: readonly TOption[],
  locale: string,
): TOption[] =>
  options.map((option) => ({
    ...option,
    label: getLanguageDisplayName(option.value, locale, option.label),
  }))
