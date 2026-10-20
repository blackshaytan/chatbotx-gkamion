import { acquireRequestSlot } from "@chatbotx.io/sdk"
import ky from "ky"
import {
  ZZAP_429_MAX_RETRIES,
  ZZAP_API_BASE_URL,
  ZZAP_API_KEY_HEADER,
  ZZAP_MIN_REQUEST_INTERVAL_SECONDS,
  ZZAP_REQUEST_TIMEOUT_MS,
} from "../constants"
import { ZzapAPIException, ZzapRateLimitException } from "../exception"
import type { ZzapAuthValue } from "../schema"

type Envelope<T> = {
  success?: boolean
  result?: T
  errors?: { error?: string } | string
  message?: string
}

export type ZzapSearchParams = Record<string, string | number | boolean>

export type ZzapClient = {
  get: <T>(path: string, searchParams?: ZzapSearchParams) => Promise<T>
  post: <T>(
    path: string,
    body: unknown,
    searchParams?: ZzapSearchParams,
  ) => Promise<T>
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const errorText = (body: Envelope<unknown>, fallback: string): string => {
  const { errors } = body
  if (typeof errors === "string" && errors) {
    return errors
  }
  if (errors && typeof errors === "object" && errors.error) {
    return errors.error
  }
  return body.message || fallback
}

const retryAfterMs = (response: Response): number => {
  const seconds = Number(response.headers.get("retry-after"))
  return Number.isFinite(seconds) ? seconds * 1000 : 0
}

/**
 * B52 API client. Every call of one key goes through the shared limiter; a
 * 429 is retried with a growing pause and surfaces as
 * `ZzapRateLimitException` once retries are exhausted.
 */
export const createZzapClient = (auth: ZzapAuthValue): ZzapClient => {
  const minIntervalMs =
    Math.max(
      auth.requestMinIntervalSeconds,
      ZZAP_MIN_REQUEST_INTERVAL_SECONDS,
    ) * 1000
  const http = ky.create({
    baseUrl: ZZAP_API_BASE_URL,
    headers: {
      [ZZAP_API_KEY_HEADER]: auth.secretText,
      Accept: "application/json",
    },
    retry: 0,
    timeout: ZZAP_REQUEST_TIMEOUT_MS,
    throwHttpErrors: false,
  })

  const request = async <T>(
    method: "get" | "post",
    path: string,
    init: { json?: unknown; searchParams?: ZzapSearchParams },
  ): Promise<T> => {
    for (let attempt = 0; attempt <= ZZAP_429_MAX_RETRIES; attempt++) {
      const release = await acquireRequestSlot(auth.secretText, minIntervalMs)
      let response: Response
      try {
        response = await http(path, {
          method,
          ...init,
        })
      } finally {
        release()
      }
      if (response.status === 429) {
        await sleep(
          Math.max(retryAfterMs(response), minIntervalMs * (attempt + 1)),
        )
        continue
      }
      const body = (await response.json().catch(() => ({}))) as Envelope<T>
      if (!response.ok || body.success === false) {
        throw new ZzapAPIException(
          errorText(body, response.statusText || "ZZAP request failed"),
          response.status,
        )
      }
      return body.result as T
    }
    throw new ZzapRateLimitException()
  }

  return {
    get: (path, searchParams) => request("get", path, { searchParams }),
    post: (path, json, searchParams) =>
      request("post", path, { json, searchParams }),
  }
}
