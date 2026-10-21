import { describe, expect, type Mock, test, vi } from "vitest"

import {
  createHermesClient,
  HermesAuthError,
  HermesRequestError,
  HermesUnavailableError,
} from "../../src/external-agent/hermes-client"

const BASE_URL = "http://hermes.test/"
const API_KEY = "test-api-key-value"

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

const createSseResponse = (chunks: string[]) => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

const createClient = (fetchImpl: typeof fetch) =>
  createHermesClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetchImpl })

const readRequest = (fetchImpl: Mock<typeof fetch>, index = 0) => {
  const [url, init] = fetchImpl.mock.calls[index] as [string, RequestInit]
  return { url, init, headers: new Headers(init.headers) }
}

describe("hermes client requests", () => {
  test("startRun sends auth, session, idempotency headers and body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ run_id: "run-1", status: "started" }, 202),
    )
    const client = createClient(fetchImpl)

    const result = await client.startRun({
      sessionKey: "session-1",
      idempotencyKey: "idem-1",
      input: "Здравствуйте",
      instructions: "инструкции",
    })

    expect(result).toEqual({ runId: "run-1" })
    const { url, init, headers } = readRequest(fetchImpl)
    expect(url).toBe("http://hermes.test/v1/runs")
    expect(init.method).toBe("POST")
    expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`)
    expect(headers.get("X-Hermes-Session-Key")).toBe("session-1")
    expect(headers.get("Idempotency-Key")).toBe("idem-1")
    expect(JSON.parse(init.body as string)).toEqual({
      input: "Здравствуйте",
      instructions: "инструкции",
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  test("startRun treats 200 as success too", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ run_id: "run-2" }),
    )
    const client = createClient(fetchImpl)

    const result = await client.startRun({
      sessionKey: "s",
      idempotencyKey: "i",
      input: "hi",
    })

    expect(result).toEqual({ runId: "run-2" })
  })

  test("startRun maps 401 to HermesAuthError without leaking the key", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: "bad key" }, 401),
    )
    const client = createClient(fetchImpl)

    const error = await client
      .startRun({ sessionKey: "s", idempotencyKey: "i", input: "hi" })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(HermesAuthError)
    expect((error as Error).message).not.toContain(API_KEY)
  })

  test("startRun maps 5xx to HermesUnavailableError", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: "boom" }, 503),
    )
    const client = createClient(fetchImpl)

    await expect(
      client.startRun({ sessionKey: "s", idempotencyKey: "i", input: "hi" }),
    ).rejects.toBeInstanceOf(HermesUnavailableError)
  })

  test("network failure maps to HermesUnavailableError", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("fetch failed")),
    )
    const client = createClient(fetchImpl)

    await expect(client.getRun("run-1")).rejects.toBeInstanceOf(
      HermesUnavailableError,
    )
  })

  test("other 4xx maps to HermesRequestError with status", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: "invalid" }, 422),
    )
    const client = createClient(fetchImpl)

    const error = await client
      .getRun("run-1")
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(HermesRequestError)
    expect((error as HermesRequestError).status).toBe(422)
  })

  test("getRun returns status, output and error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ run_id: "run-1", status: "failed", error: "boom" }),
    )
    const client = createClient(fetchImpl)

    const run = await client.getRun("run-1")

    expect(run).toEqual({ status: "failed", output: null, error: "boom" })
    expect(readRequest(fetchImpl).url).toBe("http://hermes.test/v1/runs/run-1")
  })

  test("steer returns accepted false on 409 and true on 2xx", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(jsonResponse({ accepted: true }))
    const client = createClient(fetchImpl)

    await expect(client.steer("run-1", "ещё")).resolves.toEqual({
      accepted: false,
    })
    await expect(client.steer("run-1", "ещё")).resolves.toEqual({
      accepted: true,
    })
    expect(JSON.parse(readRequest(fetchImpl, 0).init.body as string)).toEqual({
      input: "ещё",
    })
    expect(readRequest(fetchImpl, 0).url).toBe(
      "http://hermes.test/v1/runs/run-1/steer",
    )
  })

  test("stop ignores 404", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    const client = createClient(fetchImpl)

    await expect(client.stop("run-1")).resolves.toBeUndefined()
    expect(readRequest(fetchImpl).url).toBe(
      "http://hermes.test/v1/runs/run-1/stop",
    )
  })

  test("health calls GET /health and rejects on 5xx", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok" }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    const client = createClient(fetchImpl)

    await expect(client.health()).resolves.toBeUndefined()
    expect(readRequest(fetchImpl).init.method).toBe("GET")
    expect(readRequest(fetchImpl).url).toBe("http://hermes.test/health")
    await expect(client.health()).rejects.toBeInstanceOf(HermesUnavailableError)
  })
})

describe("hermes client readEvents", () => {
  test("delivers events in order and resolves closed on stream closed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      createSseResponse([
        ": open\n\n",
        'id: 6\ndata: {"event":"message.interim","run_id":"run-1","seq":6,"text":"Ищу"}\n\n',
        ": keepalive\n\n",
        'id: 7\ndata: {"event":"run.completed","run_id":"run-1","seq":7,"output":"готово"}\n\n',
        ": stream closed\n\n",
      ]),
    )
    const client = createClient(fetchImpl)
    const received: { id: number | null; event?: unknown }[] = []

    const result = await client.readEvents({
      runId: "run-1",
      lastSeq: 5,
      windowMs: 5000,
      onEvent: (event) =>
        received.push({ id: event.id, event: event.data.event }),
    })

    expect(result).toEqual({ closed: true, notFound: false })
    expect(received).toEqual([
      { id: 6, event: "message.interim" },
      { id: 7, event: "run.completed" },
    ])
    const { url, headers } = readRequest(fetchImpl)
    expect(url).toBe("http://hermes.test/v1/runs/run-1/events?last_seq=5")
    expect(headers.get("Accept")).toBe("text/event-stream")
  })

  test("resolves closed when the body ends without a stream closed comment", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      createSseResponse(['id: 1\ndata: {"event":"tool.started"}\n\n']),
    )
    const client = createClient(fetchImpl)
    const onEvent = vi.fn()

    const result = await client.readEvents({
      runId: "run-1",
      lastSeq: 0,
      windowMs: 5000,
      onEvent,
    })

    expect(result).toEqual({ closed: true, notFound: false })
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  test("resolves notFound on 404", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 404 }),
    )
    const client = createClient(fetchImpl)

    const result = await client.readEvents({
      runId: "missing",
      lastSeq: 0,
      windowMs: 5000,
      onEvent: vi.fn(),
    })

    expect(result).toEqual({ closed: false, notFound: true })
  })

  test("maps 401 to HermesAuthError", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 401 }),
    )
    const client = createClient(fetchImpl)

    await expect(
      client.readEvents({
        runId: "run-1",
        lastSeq: 0,
        windowMs: 5000,
        onEvent: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(HermesAuthError)
  })

  test("resolves not closed when the window elapses on an open stream", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": open\n\n"))
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(stream, { status: 200 }),
    )
    const client = createClient(fetchImpl)
    const onEvent = vi.fn()

    const result = await client.readEvents({
      runId: "run-1",
      lastSeq: 0,
      windowMs: 30,
      onEvent,
    })

    expect(result).toEqual({ closed: false, notFound: false })
    expect(onEvent).not.toHaveBeenCalled()
  })
})
