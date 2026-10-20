import { SdkException } from "@chatbotx.io/sdk"

const FALLBACK_HTTP_STATUS = 400

export class DromException extends SdkException {
  constructor(
    message: string,
    httpStatusCode: number = FALLBACK_HTTP_STATUS,
    code: string | number = "dromError",
  ) {
    super(message, code, httpStatusCode)
  }
}

export class DromAPIException extends DromException {}

/** The seller cookies no longer open the chat; they have to be replaced. */
export class DromSessionExpiredException extends DromException {
  constructor(message: string) {
    super(message, 401, "dromSessionExpired")
  }
}
