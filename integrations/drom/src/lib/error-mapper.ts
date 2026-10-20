import {
  ChannelError,
  ChannelErrorCategory,
  UNKNOWN_ERROR,
} from "@chatbotx.io/sdk"
import { DromException, DromSessionExpiredException } from "../exception"

const categorize = (status: number): ChannelErrorCategory => {
  if (status === 401 || status === 403) {
    return ChannelErrorCategory.AUTH_FAILED
  }
  if (status === 404) {
    return ChannelErrorCategory.INVALID_RECIPIENT
  }
  if (status === 429) {
    return ChannelErrorCategory.RATE_LIMITED
  }
  if (status >= 500) {
    return ChannelErrorCategory.NETWORK_ERROR
  }
  return ChannelErrorCategory.UNKNOWN
}

// Expired cookies show up as 401/403, a sign-in redirect or HTML instead of JSON.
export const isRevokedTokenError = (error: unknown): boolean =>
  error instanceof DromSessionExpiredException ||
  (error instanceof DromException &&
    (error.httpStatusCode === 401 || error.httpStatusCode === 403))

export const mapToChannelError = (rawError: unknown): ChannelError => {
  if (rawError instanceof ChannelError) {
    return rawError
  }
  if (rawError instanceof DromException) {
    return new ChannelError(
      rawError.message,
      categorize(rawError.httpStatusCode),
      { code: rawError.code, httpStatusCode: rawError.httpStatusCode },
    )
  }
  return new ChannelError(
    rawError instanceof Error ? rawError.message : UNKNOWN_ERROR.message,
    ChannelErrorCategory.NETWORK_ERROR,
    { code: UNKNOWN_ERROR.code, httpStatusCode: 0 },
  )
}
