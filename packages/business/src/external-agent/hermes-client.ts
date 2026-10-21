import { createSseParser, type HermesSseEvent } from "./sse"

const REQUEST_TIMEOUT_MS = 15_000
const HTTP_NOT_FOUND = 404
const HTTP_CONFLICT = 409
const HTTP_SERVER_ERROR_MIN = 500
const TRAILING_SLASHES = /\/+$/

export class HermesAuthError extends Error {
  constructor() {
    super("Hermes rejected the API key")
    this.name = "HermesAuthError"
  }
}

export class HermesUnavailableError extends Error {
  constructor(message = "Hermes is unavailable") {
    super(message)
    this.name = "HermesUnavailableError"
  }
}

export class HermesRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Hermes request failed with status ${status}`)
    this.name = "HermesRequestError"
    this.status = status
  }
}

export type HermesClientOptions = {
  baseUrl: string
  apiKey: string
  fetchImpl?: typeof fetch
}

export type HermesStartRunInput = {
  sessionKey: string
  idempotencyKey: string
  input: string
  instructions?: string
}

export type HermesRun = {
  status: string
  output: string | null
  error: string | null
}

export type HermesReadEventsInput = {
  runId: string
  lastSeq: number
  windowMs: number
  onEvent: (event: HermesSseEvent) => void
}

export type HermesReadEventsResult = {
  closed: boolean
  notFound: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const assertOk = (response: Response): void => {
  if (response.ok) {
    return
  }
  if (response.status === 401 || response.status === 403) {
    throw new HermesAuthError()
  }
  if (response.status >= HTTP_SERVER_ERROR_MIN) {
    throw new HermesUnavailableError(
      `Hermes responded with status ${response.status}`,
    )
  }
  throw new HermesRequestError(response.status)
}

const readJsonRecord = async (
  response: Response,
): Promise<Record<string, unknown>> => {
  const body: unknown = await response.json()
  if (!isRecord(body)) {
    throw new HermesUnavailableError("Hermes returned an unexpected body")
  }
  return body
}

const readStringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null

/**
 * Reads SSE frames until the server closes the stream, the body ends, or the
 * caller aborts (the abort listener cancels the reader so a pending read resolves).
 */
const consumeEventStream = async (
  response: Response,
  signal: AbortSignal,
  onEvent: HermesReadEventsInput["onEvent"],
): Promise<HermesReadEventsResult> => {
  if (signal.aborted) {
    return { closed: false, notFound: false }
  }
  if (!response.body) {
    return { closed: true, notFound: false }
  }

  const reader = response.body.getReader()
  const parser = createSseParser()
  const decoder = new TextDecoder()
  const cancelReader = () => reader.cancel().catch(() => undefined)
  signal.addEventListener("abort", cancelReader, { once: true })

  try {
    let result = await reader.read()
    while (!result.done) {
      const events = parser.push(decoder.decode(result.value, { stream: true }))
      for (const event of events) {
        onEvent(event)
      }
      if (parser.isClosed()) {
        await cancelReader()
        return { closed: true, notFound: false }
      }
      result = await reader.read()
    }
  } finally {
    signal.removeEventListener("abort", cancelReader)
  }

  return { closed: !signal.aborted, notFound: false }
}

/**
 * HTTP client for the Hermes Agent `api_server` runs API.
 * Errors never include the API key.
 */
export const createHermesClient = ({
  baseUrl,
  apiKey,
  fetchImpl = fetch,
}: HermesClientOptions) => {
  const normalizedBaseUrl = baseUrl.replace(TRAILING_SLASHES, "")
  const authHeaders = { Authorization: `Bearer ${apiKey}` }

  const send = async (path: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchImpl(`${normalizedBaseUrl}${path}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...init,
      })
    } catch {
      throw new HermesUnavailableError("Hermes is unreachable")
    }
  }

  const postJson = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    send(path, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    })

  const health = async (): Promise<void> => {
    const response = await send("/health", {
      method: "GET",
      headers: authHeaders,
    })
    assertOk(response)
  }

  const startRun = async ({
    sessionKey,
    idempotencyKey,
    input,
    instructions,
  }: HermesStartRunInput): Promise<{ runId: string }> => {
    const response = await postJson(
      "/v1/runs",
      { input, instructions },
      {
        "X-Hermes-Session-Key": sessionKey,
        "Idempotency-Key": idempotencyKey,
      },
    )
    assertOk(response)
    const body = await readJsonRecord(response)
    if (typeof body.run_id !== "string") {
      throw new HermesUnavailableError("Hermes returned no run id")
    }
    return { runId: body.run_id }
  }

  const getRun = async (runId: string): Promise<HermesRun> => {
    const response = await send(`/v1/runs/${encodeURIComponent(runId)}`, {
      method: "GET",
      headers: authHeaders,
    })
    assertOk(response)
    const body = await readJsonRecord(response)
    return {
      status: readStringOrNull(body.status) ?? "unknown",
      output: readStringOrNull(body.output),
      error: readStringOrNull(body.error),
    }
  }

  const steer = async (
    runId: string,
    text: string,
  ): Promise<{ accepted: boolean }> => {
    const response = await postJson(
      `/v1/runs/${encodeURIComponent(runId)}/steer`,
      { input: text },
    )
    if (response.status === HTTP_CONFLICT) {
      return { accepted: false }
    }
    assertOk(response)
    return { accepted: true }
  }

  const stop = async (runId: string): Promise<void> => {
    const response = await postJson(
      `/v1/runs/${encodeURIComponent(runId)}/stop`,
      {},
    )
    if (response.status === HTTP_NOT_FOUND) {
      return
    }
    assertOk(response)
  }

  const readEvents = async ({
    runId,
    lastSeq,
    windowMs,
    onEvent,
  }: HermesReadEventsInput): Promise<HermesReadEventsResult> => {
    const controller = new AbortController()
    const windowTimer = setTimeout(() => controller.abort(), windowMs)

    try {
      const response = await send(
        `/v1/runs/${encodeURIComponent(runId)}/events?last_seq=${lastSeq}`,
        {
          method: "GET",
          headers: { ...authHeaders, Accept: "text/event-stream" },
          signal: controller.signal,
        },
      )
      if (response.status === HTTP_NOT_FOUND) {
        return { closed: false, notFound: true }
      }
      assertOk(response)
      return await consumeEventStream(response, controller.signal, onEvent)
    } catch (error) {
      // The window elapsing is the normal end of a read, not a failure.
      if (controller.signal.aborted) {
        return { closed: false, notFound: false }
      }
      throw error
    } finally {
      clearTimeout(windowTimer)
    }
  }

  return { health, startRun, getRun, steer, stop, readEvents }
}

export type HermesClient = ReturnType<typeof createHermesClient>
