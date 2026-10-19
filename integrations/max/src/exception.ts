import { SdkException } from "@chatbotx.io/sdk"
import { isHTTPError } from "ky"

function asObject<T>(value: unknown): T | undefined {
  return typeof value === "object" && value !== null ? (value as T) : undefined
}

const FALLBACK_HTTP_STATUS = 400

type ErrorBody = {
  code?: string
  message?: string
}
type OriginShape = { httpStatus?: number; errorBody?: ErrorBody }

export type ChannelErrorSource = {
  httpStatusCode: number
  code?: number | string
  subCode?: number | string | null
  type?: string
  message?: string
}

export function parseOriginError(originError: unknown): ChannelErrorSource {
  if (isHTTPError(originError)) {
    const body = asObject<ErrorBody>(originError.data)
    return {
      httpStatusCode: originError.response.status,
      code: body?.code,
      message: body?.message,
    }
  }

  const shaped = asObject<OriginShape>(originError)
  if (shaped?.httpStatus !== undefined) {
    return {
      httpStatusCode: shaped.httpStatus,
      code: shaped.errorBody?.code,
      message: shaped.errorBody?.message,
    }
  }

  return {
    httpStatusCode: FALLBACK_HTTP_STATUS,
    message: originError instanceof Error ? originError.message : undefined,
  }
}

export class MaxException extends SdkException {
  constructor(
    message: string,
    httpStatusCode: number = FALLBACK_HTTP_STATUS,
    code: string | number = "maxError",
    subCode?: string | number | null,
    type?: string,
    originError?: unknown,
  ) {
    super(message, code, httpStatusCode, subCode, type)
    if (originError !== undefined) {
      this.setOriginError(originError)
    }
  }
}

export class MaxWebhookException extends MaxException {
  constructor(message: string) {
    super(`Webhook error: ${message}`)
  }
}

export class MaxAPIException extends MaxException {}
