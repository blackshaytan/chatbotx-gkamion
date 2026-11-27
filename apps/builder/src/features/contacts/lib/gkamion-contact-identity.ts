const VERIFIED_METHODS = new Set(["phone", "email", "order_history"])
const CUSTOMER_ID_RE = /^[1-9][0-9]*$/
const PHONE_RE = /^\+?[0-9\s().-]+$/
const NON_DIGIT_RE = /\D/g

export const isVerifiedGkamionMethod = (value: string | null): boolean =>
  value !== null && VERIFIED_METHODS.has(value)

/** Never repair a malformed customer identifier or interpolate it into a URL. */
export const validGkamionCustomerId = (value: unknown): string | null => {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    return null
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return null
  }
  const id = String(value)
  return CUSTOMER_ID_RE.test(id) ? id : null
}

export const matchesGkamionCustomerId = (
  body: unknown,
  expectedId: string,
): boolean => {
  if (!body || typeof body !== "object") {
    return false
  }
  const record = body as Record<string, unknown>
  const customer = record.customer ?? record
  return Boolean(
    customer &&
      typeof customer === "object" &&
      validGkamionCustomerId((customer as Record<string, unknown>).id) ===
        expectedId,
  )
}

/** Full source phones only: masks, extensions and placeholders are not contacts. */
export const usableGkamionPhone = (value: unknown): string | null => {
  if (typeof value !== "string" || !PHONE_RE.test(value.trim())) {
    return null
  }
  let digits = value.replace(NON_DIGIT_RE, "")
  if (
    digits.length < 10 ||
    digits.length > 15 ||
    digits.startsWith("0") ||
    new Set(digits).size === 1
  ) {
    return null
  }
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`
  }
  return `+${digits}`
}
