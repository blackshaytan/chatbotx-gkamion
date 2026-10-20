import { DromException } from "../exception"

type RawCookie = { name?: unknown; value?: unknown }

const RAW_HEADER = /^[^=;\s]+=[^;]*(;\s*[^=;\s]+=[^;]*)*;?$/

const fromList = (list: unknown[]): string =>
  list
    .filter(
      (item): item is RawCookie => typeof item === "object" && item !== null,
    )
    .filter((item) => typeof item.name === "string" && item.name.length > 0)
    .map(
      (item) =>
        `${item.name}=${typeof item.value === "string" ? item.value : ""}`,
    )
    .join("; ")

const invalidCookies = () =>
  new DromException("DROM cookies are empty or invalid", 400, "cookiesInvalid")

const fromJson = (text: string): string => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw invalidCookies()
  }
  if (Array.isArray(parsed)) {
    return fromList(parsed)
  }
  const cookies = (parsed as { cookies?: unknown } | null)?.cookies
  return Array.isArray(cookies) ? fromList(cookies) : ""
}

/** Accepts Cookie-Editor / Playwright JSON or a raw `Cookie` header. */
export const toCookieHeader = (input: string): string => {
  const trimmed = input.trim()
  let header = ""
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    header = fromJson(trimmed)
  } else if (RAW_HEADER.test(trimmed)) {
    header = trimmed
  }
  if (!header) {
    throw invalidCookies()
  }
  return header
}
