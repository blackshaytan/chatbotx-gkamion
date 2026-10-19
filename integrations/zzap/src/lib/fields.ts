import type { ZzapAuthValue } from "../schema"

const toCamelCase = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())

/** First non-empty string among `keys` (snake_case and their camelCase twins). */
export const pickString = (
  source: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | undefined => {
  if (!source) {
    return
  }
  for (const key of keys) {
    for (const candidate of [key, toCamelCase(key)]) {
      const value = source[candidate]
      if (
        (typeof value === "string" || typeof value === "number") &&
        String(value).trim()
      ) {
        return String(value).trim()
      }
    }
  }
}

export const objectParams = (auth: ZzapAuthValue) => ({
  code_object: auth.codeObject,
  type_object: auth.typeObject,
})
