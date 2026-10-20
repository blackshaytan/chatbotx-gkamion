export type Catalog = { [key: string]: string | Catalog }
export type FlatCatalog = Record<string, string>

const joinPath = (prefix: string, key: string) =>
  prefix ? `${prefix}.${key}` : key

export const flattenCatalog = (catalog: Catalog, prefix = ""): FlatCatalog => {
  const result: FlatCatalog = {}
  for (const [key, value] of Object.entries(catalog)) {
    const path = joinPath(prefix, key)
    if (typeof value === "string") {
      result[path] = value
      continue
    }
    Object.assign(result, flattenCatalog(value, path))
  }
  return result
}

export const buildCatalogLike = (
  shape: Catalog,
  flat: FlatCatalog,
  prefix = "",
): Catalog => {
  const result: Catalog = {}
  for (const [key, value] of Object.entries(shape)) {
    const path = joinPath(prefix, key)
    if (typeof value === "string") {
      const flatValue = flat[path]
      if (flatValue !== undefined) {
        result[key] = flatValue
      }
      continue
    }
    const child = buildCatalogLike(value, flat, path)
    if (Object.keys(child).length > 0) {
      result[key] = child
    }
  }
  return result
}

const simplePlaceholderPattern = /\{[A-Za-z][\w.-]*\}/g
const icuArgumentPattern =
  /\{[A-Za-z][\w.-]*,\s*(plural|select|selectordinal)\s*,/

const simplePlaceholders = (value: string) =>
  [...(value.match(simplePlaceholderPattern) ?? [])].sort().join()

export const listPendingKeys = (props: {
  english: FlatCatalog
  target: FlatCatalog
  sameAsEnglish: ReadonlySet<string>
  sections: readonly string[]
}) =>
  Object.keys(props.english).filter((key) => {
    const section = key.split(".")[0] ?? ""
    return (
      props.sections.includes(section) &&
      props.target[key] === props.english[key] &&
      !props.sameAsEnglish.has(key)
    )
  })

export type MergeResult = {
  target: FlatCatalog
  sameAsEnglish: string[]
  errors: string[]
}

export const mergeTranslations = (props: {
  english: FlatCatalog
  target: FlatCatalog
  sameAsEnglish: readonly string[]
  translations: FlatCatalog
}): MergeResult => {
  const errors: string[] = []
  const target = { ...props.target }
  const sameAsEnglish = new Set(props.sameAsEnglish)
  for (const [key, value] of Object.entries(props.translations)) {
    const englishValue = props.english[key]
    if (englishValue === undefined) {
      errors.push(`${key}: key does not exist in en.json`)
      continue
    }
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${key}: empty translation`)
      continue
    }
    const isIcu = icuArgumentPattern.test(englishValue)
    if (
      !isIcu &&
      simplePlaceholders(value) !== simplePlaceholders(englishValue)
    ) {
      errors.push(`${key}: placeholders differ from English`)
      continue
    }
    target[key] = value
    if (value === englishValue) {
      sameAsEnglish.add(key)
    } else {
      sameAsEnglish.delete(key)
    }
  }
  return { target, sameAsEnglish: [...sameAsEnglish].sort(), errors }
}
