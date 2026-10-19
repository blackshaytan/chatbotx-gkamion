import ky, { isHTTPError, type KyInstance } from "ky"
import { MAX_API_BASE_URL } from "../constants"
import { MaxAPIException, parseOriginError } from "../exception"
import { logger } from "./logger"

type SearchParams = Record<string, string>

type GetOptions = {
  searchParams?: SearchParams
}

type PostOptions = {
  searchParams?: SearchParams
  json?: unknown
}

class MaxHttpClient {
  private readonly client: KyInstance

  constructor(token: string) {
    this.client = ky.create({
      baseUrl: MAX_API_BASE_URL,
      headers: { Authorization: token },
      timeout: 30_000,
      retry: {
        limit: 3,
        methods: ["get", "post", "delete"],
        statusCodes: [408, 429, 500, 502, 503, 504],
        backoffLimit: 1000,
      },
      hooks: {
        beforeError: [
          ({ error, request }) => {
            if (isHTTPError(error)) {
              logger.error(
                { url: request.url, method: request.method },
                `HTTP ${error.response.status}: ${error.response.statusText}`,
              )
            }
            return error
          },
        ],
      },
    })
  }

  private toException(error: unknown): MaxAPIException {
    const source = parseOriginError(error)
    return new MaxAPIException(
      source.message ?? "MAX API call failed",
      source.httpStatusCode,
      source.code,
      source.subCode,
      source.type,
      error,
    )
  }

  private async request<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      throw this.toException(error)
    }
  }

  get<T>(endpoint: string, options?: GetOptions): Promise<T> {
    return this.request(() => this.client.get(endpoint, options).json<T>())
  }

  post<T>(endpoint: string, options?: PostOptions): Promise<T> {
    return this.request(() => this.client.post(endpoint, options).json<T>())
  }

  delete<T>(endpoint: string, options?: GetOptions): Promise<T> {
    return this.request(() => this.client.delete(endpoint, options).json<T>())
  }
}

export const createMaxClient = (token: string): MaxHttpClient =>
  new MaxHttpClient(token)
