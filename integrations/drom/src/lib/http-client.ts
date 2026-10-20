import { acquireRequestSlot } from "@chatbotx.io/sdk"
import ky, { type Options } from "ky"
import {
  DROM_BASE_URL,
  DROM_DEFAULT_REFERER,
  DROM_MAX_IMAGE_BYTES,
  DROM_REQUEST_TIMEOUT_MS,
  DROM_UPLOAD_TIMEOUT_MS,
  DROM_USER_AGENT,
} from "../constants"
import { DromAPIException, DromSessionExpiredException } from "../exception"
import type { DromAuthValue } from "../schema"

type RequestOptions = { referer?: string }

export type DromBinary = { bytes: Uint8Array; mime: string }

export type DromClient = {
  getJson: <T>(path: string, opts?: RequestOptions) => Promise<T>
  getHtml: (url: string, opts?: RequestOptions) => Promise<string>
  postForm: <T>(
    path: string,
    form: Record<string, string>,
    opts?: RequestOptions & { utfFields?: string },
  ) => Promise<T>
  postMultipart: <T>(
    path: string,
    field: string,
    file: { name: string; mime: string; bytes: Uint8Array },
  ) => Promise<T>
  getBinary: (url: string) => Promise<DromBinary>
}

const SIGN_IN_PATH = /^\/sign/
const CHARSET = /charset=([\w-]+)/i
const JSON_START = /^\s*[[{]/
const FILE_NAME_UNSAFE = /["\r\n]/g

const charsetOf = (contentType: string | null): string =>
  CHARSET.exec(contentType ?? "")?.[1]?.toLowerCase() ?? "windows-1251"

const decode = (bytes: ArrayBuffer, contentType: string | null): string => {
  const charset = charsetOf(contentType)
  return new TextDecoder(
    charset === "cp1251" ? "windows-1251" : charset,
  ).decode(bytes)
}

const ensureSession = (response: Response): void => {
  if (response.status === 401 || response.status === 403) {
    throw new DromSessionExpiredException(
      `DROM rejected the session (HTTP ${response.status})`,
    )
  }
  if (response.url && SIGN_IN_PATH.test(new URL(response.url).pathname)) {
    throw new DromSessionExpiredException("DROM redirected to the sign-in page")
  }
  if (!response.ok) {
    throw new DromAPIException(`DROM HTTP ${response.status}`, response.status)
  }
}

const parseJson = <T>(bytes: ArrayBuffer): T => {
  const text = new TextDecoder("utf-8").decode(bytes)
  if (!JSON_START.test(text)) {
    throw new DromSessionExpiredException(
      "DROM answered HTML instead of JSON — cookies expired",
    )
  }
  return JSON.parse(text) as T
}

/**
 * Seller web-chat session. Every request of one seller goes through the shared
 * request lane, so polling and sending never hit DROM back to back.
 */
export const createDromClient = (auth: DromAuthValue): DromClient => {
  const laneKey = `drom:${auth.sellerLogin}`
  const minIntervalMs = auth.requestMinIntervalSeconds * 1000
  const http = ky.create({
    baseUrl: DROM_BASE_URL,
    headers: {
      Cookie: auth.secretText,
      "User-Agent": DROM_USER_AGENT,
    },
    retry: 0,
    timeout: DROM_REQUEST_TIMEOUT_MS,
    throwHttpErrors: false,
  })

  const ajaxHeaders = (referer?: string): Record<string, string> => ({
    Accept: "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    Origin: DROM_BASE_URL,
    Referer: referer ?? DROM_DEFAULT_REFERER,
  })

  const send = async (
    url: string,
    options: Options,
  ): Promise<{ response: Response; bytes: ArrayBuffer }> => {
    const release = await acquireRequestSlot(laneKey, minIntervalMs)
    try {
      const response = await http(url, options)
      ensureSession(response)
      return { response, bytes: await response.arrayBuffer() }
    } finally {
      release()
    }
  }

  return {
    getJson: async <T>(path: string, opts?: RequestOptions) => {
      const { bytes } = await send(path, {
        method: "get",
        headers: ajaxHeaders(opts?.referer),
      })
      return parseJson<T>(bytes)
    },
    getHtml: async (url, opts) => {
      const { response, bytes } = await send(url, {
        method: "get",
        headers: { Referer: opts?.referer ?? DROM_DEFAULT_REFERER },
      })
      return decode(bytes, response.headers.get("content-type"))
    },
    postForm: async <T>(
      path: string,
      form: Record<string, string>,
      opts?: RequestOptions & { utfFields?: string },
    ) => {
      const { bytes } = await send(path, {
        method: "post",
        headers: {
          ...ajaxHeaders(opts?.referer),
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          ...(opts?.utfFields ? { "X-Utf-Fields": opts.utfFields } : {}),
        },
        body: new URLSearchParams(form).toString(),
      })
      return parseJson<T>(bytes)
    },
    postMultipart: async <T>(
      path: string,
      field: string,
      file: { name: string; mime: string; bytes: Uint8Array },
    ) => {
      const body = new FormData()
      body.append(
        field,
        new Blob([Uint8Array.from(file.bytes)], { type: file.mime }),
        file.name.replace(FILE_NAME_UNSAFE, "_") || "file",
      )
      const { bytes } = await send(path, {
        method: "post",
        headers: ajaxHeaders(),
        body,
        timeout: DROM_UPLOAD_TIMEOUT_MS,
      })
      return parseJson<T>(bytes)
    },
    getBinary: async (url) => {
      const { response, bytes } = await send(url, {
        method: "get",
        headers: {
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
          Referer: `${DROM_BASE_URL}/personal/messaging-modal`,
        },
      })
      if (bytes.byteLength > DROM_MAX_IMAGE_BYTES) {
        throw new DromAPIException(
          "DROM image is too large",
          413,
          "fileTooLarge",
        )
      }
      const mime =
        response.headers.get("content-type")?.split(";")[0]?.trim() ||
        "application/octet-stream"
      return { bytes: new Uint8Array(bytes), mime }
    },
  }
}
