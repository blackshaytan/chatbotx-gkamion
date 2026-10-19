import {
  ChannelError,
  ChannelErrorCategory,
  UNKNOWN_ERROR,
} from "@chatbotx.io/sdk"
import {
  type ChannelErrorSource,
  MaxAPIException,
  MaxException,
  parseOriginError,
} from "../exception"

const USER_BLOCKED_CODES = new Set(["chat.denied", "user.blocked"])

function categorize(fields: ChannelErrorSource): ChannelErrorCategory {
  if (typeof fields.code === "string" && USER_BLOCKED_CODES.has(fields.code)) {
    return ChannelErrorCategory.USER_BLOCKED
  }
  const status = fields.httpStatusCode
  if (status === 401) {
    return ChannelErrorCategory.AUTH_FAILED
  }
  if (status === 403) {
    return ChannelErrorCategory.USER_BLOCKED
  }
  if (status === 404) {
    return ChannelErrorCategory.INVALID_RECIPIENT
  }
  if (status === 429) {
    return ChannelErrorCategory.RATE_LIMITED
  }
  if (status === 400) {
    return ChannelErrorCategory.PAYLOAD_INVALID
  }
  if (status >= 500) {
    return ChannelErrorCategory.NETWORK_ERROR
  }
  return ChannelErrorCategory.UNKNOWN
}

const toSource = (error: unknown): ChannelErrorSource =>
  error instanceof MaxAPIException
    ? {
        message: error.message,
        code: error.code,
        subCode: error.subCode ?? null,
        type: error.type,
        httpStatusCode: error.httpStatusCode,
      }
    : parseOriginError(error)

// MAX rejects an invalid or revoked bot token with HTTP 401.
export function isRevokedTokenError(error: unknown): boolean {
  const status =
    error instanceof MaxException
      ? error.httpStatusCode
      : parseOriginError(error).httpStatusCode
  return status === 401
}

export function mapToChannelError(rawError: unknown): ChannelError {
  if (rawError instanceof ChannelError) {
    return rawError
  }
  const fields = toSource(rawError)
  return new ChannelError(
    fields.message ?? UNKNOWN_ERROR.message,
    categorize(fields),
    {
      code: fields.code ?? UNKNOWN_ERROR.code,
      httpStatusCode: fields.httpStatusCode,
    },
  )
}
