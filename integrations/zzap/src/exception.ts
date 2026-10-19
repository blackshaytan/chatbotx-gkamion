import { SdkException } from "@chatbotx.io/sdk"

const FALLBACK_HTTP_STATUS = 400

export class ZzapException extends SdkException {
  constructor(
    message: string,
    httpStatusCode: number = FALLBACK_HTTP_STATUS,
    code: string | number = "zzapError",
  ) {
    super(message, code, httpStatusCode)
  }
}

export class ZzapAPIException extends ZzapException {}

export class ZzapRateLimitException extends ZzapAPIException {
  constructor() {
    super("ZZAP rate limit (429) persisted after retries", 429, "rateLimited")
  }
}
