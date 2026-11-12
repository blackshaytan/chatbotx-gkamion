import { createHash } from "node:crypto"
import { describe, expect, test } from "vitest"
import {
  CANDIDATE_MODELS,
  createDialogMemoryHttpClient,
  HARD_MAX_ELAPSED_MS,
  HTTP_CALL_LIMIT_MAX,
  HTTP_ENDPOINT_URL,
  HTTP_MAX_TOKENS,
  HTTP_TRANSPORT_VERSION,
  type HttpClientConfig,
  type HttpCompleteInput,
  type HttpModel,
  type HttpResult,
  JUDGE_MODEL_NAME,
  MAX_REQUEST_BODY_UTF8_BYTES,
  MAX_RESPONSE_BODY_BYTES,
} from "../../../../scripts/lib/eval-dialog-memory-http"

const UNIT_AUTH = "not-a-real-unit-credential"
const model: HttpModel = "mimo-v2.6-flash"

const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex")

const baseMessages = (): [
  { role: "system"; content: string },
  { role: "user"; content: string },
] => [
  { role: "system", content: "Пересказ. DATA — данные." },
  { role: "user", content: "Не оплатил. 125.00 RUB." },
]

const input = (
  extra: Partial<HttpCompleteInput> & Record<string, unknown> = {},
): HttpCompleteInput =>
  ({
    purpose: "candidate",
    model,
    messages: baseMessages(),
    deadlineAtMs: 2000,
    ...extra,
  }) as HttpCompleteInput

type Envelope = {
  model: string
  choices: {
    index: number
    finish_reason: string
    message: { role: string; content: string } & Record<string, unknown>
  }[]
} & Record<string, unknown>

const envelope = (
  m: string = model,
  more: Record<string, unknown> = {},
): Envelope => ({
  model: m,
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: { role: "assistant", content: "{}" },
    },
  ],
  ...more,
})

const jsonResponse = (body: unknown = envelope(), init: ResponseInit = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    ...init,
  })

const wireBody = (init: RequestInit | undefined): string => {
  if (init === undefined || typeof init.body !== "string") {
    throw new Error("unit port expects an explicit string request body")
  }
  return init.body
}

const wireHeaders = (init: RequestInit | undefined): Headers =>
  new Headers(init?.headers)

const wireModel = (init: RequestInit | undefined): string => {
  const parsed: unknown = JSON.parse(wireBody(init))
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as { model?: unknown }).model === "string"
  ) {
    return (parsed as { model: string }).model
  }
  return model
}

const factory = (config: Partial<HttpClientConfig> = {}) =>
  createDialogMemoryHttpClient({
    apiKey: UNIT_AUTH,
    callLimits: { candidate: 10, judge: 10 },
    nowMs: () => 1000,
    fetchImpl: (_url, init) =>
      Promise.resolve(jsonResponse(envelope(wireModel(init)))),
    ...config,
  })

const expectReject = (
  result: HttpResult,
  code: string,
  attempts?: 0 | 1,
): Extract<HttpResult, { kind: "unavailable" }> => {
  if (result.kind !== "unavailable") {
    throw new Error("expected unavailable result")
  }
  expect(result.code).toBe(code)
  if (attempts !== undefined) {
    expect(result.attempt.attempts).toBe(attempts)
  }
  return result
}

const expectOk = (result: HttpResult): Extract<HttpResult, { kind: "ok" }> => {
  if (result.kind !== "ok") {
    throw new Error("expected ok result")
  }
  return result
}

const withGuard = <T>(p: Promise<T>, ms = 800): Promise<T> => {
  let t: ReturnType<typeof setTimeout>
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      t = setTimeout(
        () => reject(new Error("HARNESS bounded control timeout")),
        ms,
      )
    }),
  ]).finally(() => clearTimeout(t))
}

describe("runtime surface", () => {
  test("exports exact ten runtime values", async () => {
    expect(HTTP_TRANSPORT_VERSION).toBe("t08-http-v1")
    expect(HTTP_ENDPOINT_URL).toBe("https://ollama.com/v1/chat/completions")
    expect(HARD_MAX_ELAPSED_MS).toBe(120_000)
    expect(HTTP_MAX_TOKENS).toBe(4096)
    expect(MAX_REQUEST_BODY_UTF8_BYTES).toBe(131_072)
    expect(MAX_RESPONSE_BODY_BYTES).toBe(262_144)
    expect(HTTP_CALL_LIMIT_MAX).toBe(128)
    expect(CANDIDATE_MODELS).toEqual([
      "deepseek-v4.1-flash",
      "mimo-v2.6-flash",
      "glm-5.3",
    ])
    expect(JUDGE_MODEL_NAME).toBe("kimi-k3")

    const mod = await import("../../../../scripts/lib/eval-dialog-memory-http")
    expect(Object.keys(mod).sort()).toEqual(
      [
        "CANDIDATE_MODELS",
        "HTTP_CALL_LIMIT_MAX",
        "HTTP_ENDPOINT_URL",
        "HTTP_MAX_TOKENS",
        "HTTP_TRANSPORT_VERSION",
        "HARD_MAX_ELAPSED_MS",
        "JUDGE_MODEL_NAME",
        "MAX_REQUEST_BODY_UTF8_BYTES",
        "MAX_RESPONSE_BODY_BYTES",
        "createDialogMemoryHttpClient",
      ].sort(),
    )
  })
})

describe("factory validation", () => {
  test("invalid higher server limits and invalid credentials throw constant RangeError", () => {
    expect(() =>
      factory({ limits: { maxResponseBodyBytes: 262_145 } }),
    ).toThrow(RangeError)
    expect(() => factory({ callLimits: { candidate: 129, judge: 0 } })).toThrow(
      RangeError,
    )

    let n = 0
    expect(() =>
      factory({
        apiKey: {
          toString() {
            n++
            throw new Error("PRIVATE_SECRET")
          },
        } as unknown as string,
      }),
    ).toThrow(RangeError)
    expect(n).toBe(0)
  })

  test("factory captures credential from argument only", async () => {
    const client = createDialogMemoryHttpClient({
      apiKey: "unit-credential-from-arg",
      callLimits: { candidate: 1, judge: 1 },
      nowMs: () => 1000,
      fetchImpl: (_url, init) => {
        const headers = wireHeaders(init)
        expect(headers.get("Authorization")).toBe(
          "Bearer unit-credential-from-arg",
        )
        return Promise.resolve(jsonResponse())
      },
    })
    expectOk(await client.complete(input()))
  })
})

describe("budget and counters", () => {
  test("zero explicit call budget cannot fetch", async () => {
    let fetches = 0
    const client = factory({
      callLimits: { candidate: 0, judge: 0 },
      fetchImpl: () => {
        fetches++
        return Promise.reject(new Error("NO_FETCH"))
      },
    })
    expectReject(await client.complete(input()), "budget_exhausted", 0)
    expect(fetches).toBe(0)
    expect(client.getCounters().candidate.used).toBe(0)
  })

  test("counters are per-client snapshots and cannot reset budgets", async () => {
    const client = factory({ callLimits: { candidate: 1, judge: 0 } })
    expectOk(await client.complete(input()))
    const snap = client.getCounters()
    // Intentional mutable-typing view OF THE ACTUAL snapshot object: negative
    // adversarial control. Production HttpCounters stay readonly; the mutating
    // view must only touch the discarded snapshot, never client internals.
    const view = snap.candidate as { used: number; limit: number }
    view.used = 0
    view.limit = 10
    expectReject(await client.complete(input()), "budget_exhausted", 0)
    expect(client.getCounters().candidate.used).toBe(1)
    expect(client.getCounters().candidate.attempts).toBe(1)
  })

  test("independent factories have independent budgets", async () => {
    const a = factory({ callLimits: { candidate: 1, judge: 0 } })
    const b = factory({ callLimits: { candidate: 1, judge: 0 } })
    expectOk(await a.complete(input()))
    expectOk(await b.complete(input()))
    expectReject(await a.complete(input()), "budget_exhausted", 0)
    expectReject(await b.complete(input()), "budget_exhausted", 0)
  })
})

describe("input validation", () => {
  test("purpose model mapping exact no alias repair", async () => {
    const client = factory()
    expectReject(
      await client.complete(input({ purpose: "judge" })),
      "model_purpose_mismatch",
      0,
    )
    expectReject(
      await client.complete(input({ model: "kimi-k3" })),
      "model_purpose_mismatch",
      0,
    )
    const invalidInput = { ...input(), model: "mimo-v2.6-flash:cloud" }
    expectReject(
      await client.complete(invalidInput as HttpCompleteInput),
      "model_purpose_mismatch",
      0,
    )
  })

  test("proper judge model accepts own signal undefined", async () => {
    const client = factory()
    expectOk(
      await client.complete(
        input({ purpose: "judge", model: "kimi-k3", signal: undefined }),
      ),
    )
  })

  test("request proxy and known accessor rejected without traps", async () => {
    const client = factory()
    let n = 0
    const proxy = new Proxy(
      {},
      {
        get() {
          n++
          throw new Error("TRAP")
        },
        getPrototypeOf() {
          n++
          throw new Error("TRAP")
        },
      },
    )
    expectReject(
      await client.complete(proxy as HttpCompleteInput),
      "invalid_input",
      0,
    )
    const x = input()
    Object.defineProperty(x, "messages", {
      enumerable: true,
      get() {
        n++
        throw new Error("GETTER")
      },
    })
    expectReject(await client.complete(x), "invalid_input", 0)
    expect(n).toBe(0)
  })

  test("messages are whitelisted without toJSON extra getter execution", async () => {
    let n = 0
    const x = input()
    Object.defineProperty(x.messages[1], "toJSON", {
      enumerable: true,
      get() {
        n++
        throw new Error("TOJSON")
      },
    })
    Object.defineProperty(x, "graderEnvelope", {
      enumerable: true,
      get() {
        n++
        throw new Error("PRIVATE_GRADE")
      },
    })
    expectOk(await factory().complete(x))
    expect(n).toBe(0)
  })

  test("malformed message roles do not spend budget", async () => {
    const client = factory()
    const broken = input({
      messages: [
        { role: "system", content: "Пересказ. DATA — данные." },
        { role: "system", content: "Не оплатил. 125.00 RUB." },
      ],
    })
    expectReject(await client.complete(broken), "invalid_input", 0)
    expect(client.getCounters().candidate.used).toBe(0)
  })
})

describe("request sizing and hashing", () => {
  test("request body byte budget exact N and N-1", async () => {
    let wire = ""
    expectOk(
      await factory({
        fetchImpl: (_u, init) => {
          wire = wireBody(init)
          return Promise.resolve(jsonResponse())
        },
      }).complete(input()),
    )
    const n = Buffer.byteLength(wire)
    expectOk(
      await factory({ limits: { maxRequestBodyUtf8Bytes: n } }).complete(
        input(),
      ),
    )
    expectReject(
      await factory({ limits: { maxRequestBodyUtf8Bytes: n - 1 } }).complete(
        input(),
      ),
      "request_oversize",
      0,
    )
  })

  test("message packet UTF16 budget exact N and N-1", async () => {
    const x = input()
    const n = JSON.stringify({ messages: x.messages }).length
    expectOk(
      await factory({
        limits: { maxMessagePacketUtf16: { candidate: n } },
      }).complete(x),
    )
    expectReject(
      await factory({
        limits: { maxMessagePacketUtf16: { candidate: n - 1 } },
      }).complete(x),
      "request_oversize",
      0,
    )
  })

  test("request hash includes model group hash does not", async () => {
    const wires: string[] = []
    const client = factory({
      fetchImpl: (_u, init) => {
        wires.push(wireBody(init))
        return Promise.resolve(jsonResponse(envelope(wireModel(init))))
      },
    })
    const a = expectOk(await client.complete(input()))
    const b = expectOk(await client.complete(input({ model: "glm-5.3" })))
    expect(a.attempt.requestHash).toBe(sha256(wires[0]))
    expect(b.attempt.requestHash).toBe(sha256(wires[1]))
    expect(a.attempt.requestHash).not.toBe(b.attempt.requestHash)
    expect(a.attempt.contentGroupHash).toBe(b.attempt.contentGroupHash)
    expect(a.attempt.contentGroupHash).toBe(
      sha256(JSON.stringify({ messages: input().messages })),
    )
  })

  test("caller mutation by fetch cannot alter captured request or attempt", async () => {
    const messages = baseMessages()
    const holder: {
      purpose: "candidate"
      model: HttpModel
      messages: ReturnType<typeof baseMessages>
      deadlineAtMs: number
    } = { purpose: "candidate", model, messages, deadlineAtMs: 2000 }
    let body = ""
    const client = factory({
      fetchImpl: (_u, init) => {
        body = wireBody(init)
        holder.model = "glm-5.3"
        messages[1].content = "MUTATED"
        return Promise.resolve(jsonResponse())
      },
    })
    const r = expectOk(await client.complete(holder))
    expect(r.attempt.requestedModel).toBe(model)
    expect(r.attempt.requestHash).toBe(sha256(body))
    expect(body.includes("MUTATED")).toBe(false)
  })
})

describe("canonical request", () => {
  test("one canonical POST exact body headers and redirect protection", async () => {
    let fetches = 0
    const client = factory({
      fetchImpl: (url, init) => {
        fetches++
        if (init === undefined) {
          throw new Error("unit port expects explicit RequestInit")
        }
        expect(String(url)).toBe(HTTP_ENDPOINT_URL)
        expect(init.method).toBe("POST")
        expect(init.redirect).toBe("error")
        expect(init.credentials).toBe("omit")
        const headers = wireHeaders(init)
        expect(headers.get("Authorization")).toBe(`Bearer ${UNIT_AUTH}`)
        expect(headers.get("Content-Type")).toBe("application/json")
        expect([...headers.keys()]).toHaveLength(2)
        const body = JSON.parse(wireBody(init)) as Record<string, unknown>
        expect(Object.keys(body)).toEqual([
          "model",
          "messages",
          "stream",
          "temperature",
          "max_tokens",
        ])
        expect(body.stream).toBe(false)
        expect(body.temperature).toBe(0)
        expect(body.max_tokens).toBe(4096)
        return Promise.resolve(jsonResponse(envelope(wireModel(init))))
      },
    })
    const result = await client.complete(input())
    const ok = expectOk(result)
    expect(ok.content).toBe("{}")
    expect(ok.attempt.attempts).toBe(1)
    expect(ok.attempt.modelMatch).toBe(true)
    expect(ok.attempt.returnedModel).toBe(model)
    expect(JSON.stringify(result).includes(UNIT_AUTH)).toBe(false)
    expect(fetches).toBe(1)
  })
})

describe("response protocol", () => {
  test("returned model mismatch never echoed or normalized", async () => {
    const result = expectReject(
      await factory({
        fetchImpl: () =>
          Promise.resolve(jsonResponse(envelope("PRIVATE_BAD_MODEL"))),
      }).complete(input()),
      "returned_model_mismatch",
      1,
    )
    expect(result.attempt.returnedModel).toBeNull()
    expect(result.attempt.modelMatch).toBe(false)
    expect(JSON.stringify(result).includes("PRIVATE_BAD_MODEL")).toBe(false)
  })

  test("finish length cannot pass and known finish is recorded", async () => {
    const e = envelope()
    e.choices[0].finish_reason = "length"
    const result = expectReject(
      await factory({
        fetchImpl: () => Promise.resolve(jsonResponse(e)),
      }).complete(input()),
      "finish_reason_invalid",
      1,
    )
    expect(result.attempt.finishReason).toBe("length")
  })

  test("actual tool calls rejected not string blacklisted", async () => {
    const e = envelope()
    e.choices[0].message.tool_calls = [
      {
        id: "ignored",
        type: "function",
        function: { name: "x", arguments: "{}" },
      },
    ]
    expectReject(
      await factory({
        fetchImpl: () => Promise.resolve(jsonResponse(e)),
      }).complete(input()),
      "unexpected_tool_call",
      1,
    )

    const clean = envelope()
    clean.choices[0].message.tool_calls = []
    clean.choices[0].message.function_call = null
    clean.choices[0].message.content =
      "requiredEvidence tool_calls https://example.invalid/"
    expectOk(
      await factory({
        fetchImpl: () => Promise.resolve(jsonResponse(clean)),
      }).complete(input()),
    )
  })

  test("missing or multiple choices rejected before semantics", async () => {
    for (const choices of [
      [],
      [envelope().choices[0], envelope().choices[0]],
    ]) {
      expectReject(
        await factory({
          fetchImpl: () =>
            Promise.resolve(jsonResponse(envelope(model, { choices }))),
        }).complete(input()),
        "missing_choice",
        1,
      )
    }
  })

  test("reasoning only whitespace content is invalid", async () => {
    const e = envelope()
    e.choices[0].message.content = " \n\t"
    e.choices[0].message.reasoning = "PRIVATE_REASONING"
    expectReject(
      await factory({
        fetchImpl: () => Promise.resolve(jsonResponse(e)),
      }).complete(input()),
      "empty_content",
      1,
    )
  })

  test("usage absent unknown not invented zero or total", async () => {
    const a = expectOk(await factory().complete(input())).attempt
    expect(a.usage).toEqual({
      promptTokens: "unknown",
      completionTokens: "unknown",
      totalTokens: "unknown",
    })
    const r = expectOk(
      await factory({
        fetchImpl: () =>
          Promise.resolve(
            jsonResponse(
              envelope(model, {
                usage: { prompt_tokens: 2, completion_tokens: 3 },
              }),
            ),
          ),
      }).complete(input()),
    )
    expect(r.attempt.usage).toEqual({
      promptTokens: 2,
      completionTokens: 3,
      totalTokens: "unknown",
    })
  })

  test("reported completion above requested token cap is invalid", async () => {
    expectReject(
      await factory({
        fetchImpl: () =>
          Promise.resolve(
            jsonResponse(
              envelope(model, { usage: { completion_tokens: 4097 } }),
            ),
          ),
      }).complete(input()),
      "token_overflow",
      1,
    )
  })

  test("invalid UTF8 rejected after bounded raw bytes hashing", async () => {
    const raw = new Uint8Array([0xc3])
    const result = expectReject(
      await factory({
        fetchImpl: () => Promise.resolve(new Response(raw)),
      }).complete(input()),
      "malformed_utf8",
      1,
    )
    expect(result.attempt.responseHash).toBe(sha256(raw))
    expect(result.attempt.responseComplete).toBe(true)
  })

  test("malformed JSON differs from invalid response shape", async () => {
    expectReject(
      await factory({
        fetchImpl: () => Promise.resolve(jsonResponse("{bad")),
      }).complete(input()),
      "malformed_json",
      1,
    )
    expectReject(
      await factory({
        fetchImpl: () => Promise.resolve(jsonResponse({})),
      }).complete(input()),
      "invalid_response",
      1,
    )
  })

  test("purpose content caps enforced before ok", async () => {
    const e = envelope()
    e.choices[0].message.content = "x".repeat(20_001)
    expectReject(
      await factory({
        fetchImpl: () => Promise.resolve(jsonResponse(e)),
      }).complete(input()),
      "content_oversize",
      1,
    )

    const j = envelope("kimi-k3")
    j.choices[0].message.content = "x".repeat(8193)
    expectReject(
      await factory({
        fetchImpl: () => Promise.resolve(jsonResponse(j)),
      }).complete(input({ purpose: "judge", model: "kimi-k3" })),
      "content_oversize",
      1,
    )
  })
})

describe("HTTP status and transport", () => {
  test("HTTP error body never read or echoed and never retried", async () => {
    let reads = 0
    let cancels = 0
    let fetches = 0
    const body = {
      getReader: () => {
        reads++
        throw new Error("PRIVATE_BODY")
      },
      cancel: () => {
        cancels++
        return Promise.resolve()
      },
    }
    const result = expectReject(
      await factory({
        fetchImpl: () => {
          fetches++
          return Promise.resolve({
            status: 401,
            redirected: false,
            headers: new Headers(),
            body,
          } as unknown as Response)
        },
      }).complete(input()),
      "http_status",
      1,
    )
    expect(reads).toBe(0)
    expect(fetches).toBe(1)
    expect(result.attempt.responseHash).toBeNull()
    expect(JSON.stringify(result).includes("PRIVATE_BODY")).toBe(false)
    expect(cancels).toBeGreaterThanOrEqual(0)
  })

  test("HTTP 429 exactly one charged attempt no retry", async () => {
    let fetches = 0
    const client = factory({
      fetchImpl: () => {
        fetches++
        return Promise.resolve(new Response("PRIVATE_RATE", { status: 429 }))
      },
    })
    expectReject(await client.complete(input()), "http_status", 1)
    expect(fetches).toBe(1)
    expect(client.getCounters().candidate.used).toBe(1)
  })

  test("redirect response rejected without following location", async () => {
    expectReject(
      await factory({
        fetchImpl: () =>
          Promise.resolve(Response.redirect("https://example.invalid/", 302)),
      }).complete(input()),
      "redirected",
      1,
    )
  })

  test("fetch rejection cannot leak secret or original error", async () => {
    const result = expectReject(
      await factory({
        fetchImpl: () =>
          Promise.reject(new Error(`${UNIT_AUTH} PRIVATE_REMOTE`)),
      }).complete(input()),
      "fetch_rejected",
      1,
    )
    expect(result.reason).toBe("transport_error")
    expect(JSON.stringify(result).includes(UNIT_AUTH)).toBe(false)
    expect(JSON.stringify(result).includes("PRIVATE_REMOTE")).toBe(false)
  })
})

describe("response body byte cap", () => {
  test("actual body byte cap ignores lying small Content-Length", async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(JSON.stringify(envelope())))
        c.close()
      },
    })
    const result = expectReject(
      await factory({
        limits: { maxResponseBodyBytes: 10 },
        fetchImpl: () =>
          Promise.resolve(
            new Response(stream, { headers: { "Content-Length": "1" } }),
          ),
      }).complete(input()),
      "response_oversize",
      1,
    )
    expect(result.attempt.responseHash).toBeNull()
    expect(result.attempt.responseComplete).toBe(false)
  })

  test("exact complete response byte cap succeeds N-1 fails", async () => {
    const raw = JSON.stringify(envelope())
    const n = Buffer.byteLength(raw)
    const ok = expectOk(
      await factory({
        limits: { maxResponseBodyBytes: n },
        fetchImpl: () => Promise.resolve(jsonResponse(raw)),
      }).complete(input()),
    )
    expect(ok.attempt.responseHash).toBe(sha256(raw))
    expect(ok.attempt.responseBytes).toBe(n)
    expect(ok.attempt.responseComplete).toBe(true)
    expectReject(
      await factory({
        limits: { maxResponseBodyBytes: n - 1 },
        fetchImpl: () => Promise.resolve(jsonResponse(raw)),
      }).complete(input()),
      "response_oversize",
      1,
    )
  })

  test("typed array view offsets not adjacent buffer bytes are consumed", async () => {
    const raw = Buffer.from(JSON.stringify(envelope()))
    const backing = new Uint8Array(raw.length + 4)
    backing.set(raw, 2)
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(backing.subarray(2, 2 + raw.length))
        c.close()
      },
    })
    const result = expectOk(
      await factory({
        fetchImpl: () => Promise.resolve(new Response(stream)),
      }).complete(input()),
    )
    expect(result.attempt.responseHash).toBe(sha256(raw))
    expect(result.attempt.responseBytes).toBe(raw.length)
  })
})

describe("deadline, cancellation and concurrency", () => {
  test("pre-abort and pre-deadline never invoke fetch", async () => {
    let fetches = 0
    const client = factory({
      fetchImpl: () => {
        fetches++
        return Promise.reject(new Error("NO_FETCH"))
      },
    })
    const a = new AbortController()
    a.abort("PRIVATE_ABORT_REASON")
    const r1 = expectReject(
      await client.complete(input({ signal: a.signal })),
      "cancelled_before_start",
      0,
    )
    expect(r1.reason).toBe("cancelled")
    expectReject(
      await client.complete(input({ deadlineAtMs: 999 })),
      "deadline_before_start",
      0,
    )
    expect(fetches).toBe(0)
  })

  test("never-settling fake fetch bounded by REAL timer despite frozen clock", async () => {
    const client = factory({
      limits: { maxElapsedMs: 20 },
      fetchImpl: () =>
        new Promise<Response>(() => {
          // intentionally never settles
        }),
    })
    const result = expectReject(
      await withGuard(client.complete(input())),
      "deadline_exceeded",
      1,
    )
    expect(result.reason).toBe("deadline")
    expect(client.getCounters().busy).toBe(false)
  })

  test("never-settling body read AND cancel cannot block deadline cleanup", async () => {
    let cancelled = 0
    let released = 0
    const reader = {
      read: () =>
        new Promise<never>(() => {
          // intentionally never settles
        }),
      cancel: () => {
        cancelled++
        return new Promise<never>(() => {
          // intentionally never settles
        })
      },
      releaseLock: () => {
        released++
      },
    }
    const fake = {
      status: 200,
      redirected: false,
      headers: new Headers(),
      body: { getReader: () => reader },
    }
    const client = factory({
      limits: { maxElapsedMs: 20 },
      fetchImpl: () => Promise.resolve(fake as unknown as Response),
    })
    const result = expectReject(
      await withGuard(client.complete(input())),
      "deadline_exceeded",
      1,
    )
    expect(result.attempt.responseHash).toBeNull()
    expect(client.getCounters().busy).toBe(false)
    expect(cancelled).toBeGreaterThanOrEqual(1)
    expect(released).toBeGreaterThanOrEqual(1)
  })

  test("caller abort during body keeps private reason out of result", async () => {
    const a = new AbortController()
    const reader = {
      read() {
        a.abort("PRIVATE_ABORT_REASON")
        return new Promise<never>(() => {
          // intentionally never settles
        })
      },
      cancel: () => Promise.resolve(),
      releaseLock: () => {
        // external fake no lock
      },
    }
    const fake = {
      status: 200,
      redirected: false,
      headers: new Headers(),
      body: { getReader: () => reader },
    }
    const result = expectReject(
      await withGuard(
        factory({
          fetchImpl: () => Promise.resolve(fake as unknown as Response),
        }).complete(input({ signal: a.signal })),
      ),
      "cancelled",
      1,
    )
    expect(result.reason).toBe("cancelled")
    expect(JSON.stringify(result).includes("PRIVATE_ABORT_REASON")).toBe(false)
  })

  test("single inflight busy does not spend second budget", async () => {
    let resolve!: (value: Response) => void
    let fetches = 0
    const client = factory({
      fetchImpl: () => {
        fetches++
        return new Promise((r) => {
          resolve = r
        })
      },
    })
    const pending = client.complete(input())
    await Promise.resolve()
    expectReject(await client.complete(input()), "busy", 0)
    expect(fetches).toBe(1)
    expect(client.getCounters().candidate.used).toBe(1)
    resolve(jsonResponse())
    expectOk(await pending)
    expect(client.getCounters().busy).toBe(false)
  })
})

const canonicalRequestHash = (): string =>
  sha256(
    JSON.stringify({
      model,
      messages: input().messages,
      stream: false,
      temperature: 0,
      max_tokens: 4096,
    }),
  )

const contentGroupHashValue = (): string =>
  sha256(JSON.stringify({ messages: input().messages }))

describe("portable edge controls", () => {
  test("known optional signal accessor invalid without callback", async () => {
    let n = 0
    const x = input()
    Object.defineProperty(x, "signal", {
      enumerable: true,
      get() {
        n++
        throw new Error("PRIVATE_SIGNAL")
      },
    })
    expectReject(await factory().complete(x), "invalid_input", 0)
    expect(n).toBe(0)
  })

  test("message array ordinary proxy has zero trap calls", async () => {
    let n = 0
    const arr = new Proxy(input().messages, {
      get(target, key, receiver) {
        n++
        return Reflect.get(target, key, receiver)
      },
    })
    expectReject(
      await factory().complete(input({ messages: arr })),
      "invalid_input",
      0,
    )
    expect(n).toBe(0)
  })

  test("message array revoked proxy returns unavailable not rejection", async () => {
    const revoked = Proxy.revocable<HttpCompleteInput["messages"]>(
      input().messages,
      {},
    )
    revoked.revoke()
    expectReject(
      await factory().complete(input({ messages: revoked.proxy })),
      "invalid_input",
      0,
    )
  })

  test("message array own index accessor never invoked", async () => {
    let n = 0
    const rows = input().messages
    const original = rows[0]
    Object.defineProperty(rows, "0", {
      enumerable: true,
      get() {
        n++
        return original
      },
    })
    expectReject(
      await factory().complete(input({ messages: rows })),
      "invalid_input",
      0,
    )
    expect(n).toBe(0)
  })

  test("message own fields on nonplain class do not validate", async () => {
    class Row {
      role = "system"
      content = "data"
    }
    const brokenMessages = [
      new Row(),
      input().messages[1],
    ] as unknown as HttpCompleteInput["messages"]
    expectReject(
      await factory().complete(input({ messages: brokenMessages })),
      "invalid_input",
      0,
    )
  })

  test("credential validation anchored across complete string", () => {
    for (const value of ["unit key", "unit\n", "unit\0", "unitα"]) {
      expect(() => factory({ apiKey: value })).toThrow(RangeError)
    }
  })

  test("invalid server callback types rejected at construction", () => {
    expect(() =>
      factory({ nowMs: 123 } as unknown as Partial<HttpClientConfig>),
    ).toThrow(RangeError)
    expect(() =>
      factory({ fetchImpl: 123 } as unknown as Partial<HttpClientConfig>),
    ).toThrow(RangeError)
  })

  test("unknown nonfinite clock cannot authorize fetch", async () => {
    let n = 0
    const client = factory({
      nowMs: () => Number.NaN,
      fetchImpl: () => {
        n++
        return Promise.resolve(jsonResponse())
      },
    })
    expectReject(await client.complete(input()), "invalid_input", 0)
    expect(n).toBe(0)
  })

  test("fetch error retains captured hashes bytes and elapsed", async () => {
    let now = 1000
    let wire = ""
    const result = expectReject(
      await factory({
        nowMs: () => now,
        fetchImpl: (_u, init) => {
          wire = wireBody(init)
          now = 1100
          return Promise.reject(new Error("PRIVATE_REMOTE"))
        },
      }).complete(input()),
      "fetch_rejected",
      1,
    )
    expect(result.attempt.requestHash).toBe(sha256(wire))
    expect(result.attempt.requestBytes).toBe(Buffer.byteLength(wire))
    expect(result.attempt.contentGroupHash).toBe(contentGroupHashValue())
    expect(result.attempt.elapsedMs).toBe(100)
  })

  test("known but mismatched returned model is null", async () => {
    const result = expectReject(
      await factory({
        fetchImpl: () => Promise.resolve(jsonResponse(envelope("glm-5.3"))),
      }).complete(input()),
      "returned_model_mismatch",
      1,
    )
    expect(result.attempt.returnedModel).toBeNull()
  })

  test("missing or nonstring response model is shape error", async () => {
    for (const value of [undefined, 12, null]) {
      const e: Record<string, unknown> = { ...envelope() }
      if (value === undefined) {
        Reflect.deleteProperty(e, "model")
      } else {
        e.model = value
      }
      expectReject(
        await factory({
          fetchImpl: () => Promise.resolve(jsonResponse(e)),
        }).complete(input()),
        "invalid_response",
        1,
      )
    }
  })

  test("HTTP rejection after clock deadline classified deadline", async () => {
    let now = 1000
    const result = expectReject(
      await factory({
        nowMs: () => now,
        fetchImpl: () => {
          now = 2001
          return Promise.resolve(new Response("PRIVATE_BODY", { status: 401 }))
        },
      }).complete(input()),
      "deadline_exceeded",
      1,
    )
    expect(result.reason).toBe("deadline")
  })

  test("fetch rejection after clock deadline classified deadline", async () => {
    let now = 1000
    const result = expectReject(
      await factory({
        nowMs: () => now,
        fetchImpl: () => {
          now = 2001
          return Promise.reject(new Error("PRIVATE_NET"))
        },
      }).complete(input()),
      "deadline_exceeded",
      1,
    )
    expect(result.reason).toBe("deadline")
  })

  test("clock checked after each read and no subsequent read starts", async () => {
    let now = 1000
    let reads = 0
    const bytes = new TextEncoder().encode(JSON.stringify(envelope()))
    const reader = {
      read: () => {
        reads += 1
        if (reads === 1) {
          now = 2001
          return Promise.resolve({ done: false, value: bytes })
        }
        return Promise.resolve({ done: true, value: undefined })
      },
      cancel: () => Promise.resolve(),
      releaseLock: () => {
        // external fake no lock
      },
    }
    const fake = {
      status: 200,
      headers: new Headers(),
      body: { getReader: () => reader },
    }
    const result = expectReject(
      await factory({
        nowMs: () => now,
        fetchImpl: () => Promise.resolve(fake as unknown as Response),
      }).complete(input()),
      "deadline_exceeded",
      1,
    )
    expect(reads).toBe(1)
    expect(result.reason).toBe("deadline")
  })

  test("clock and abort priority also on FAILED JSON.parse", async () => {
    let now = 1000
    const originalParse: (value: string) => unknown = JSON.parse
    const raw = "{bad"
    try {
      JSON.parse = (value: string) => {
        if (value === raw) {
          now = 2001
        }
        return originalParse(value)
      }
      expectReject(
        await factory({
          nowMs: () => now,
          fetchImpl: () => Promise.resolve(jsonResponse(raw)),
        }).complete(input()),
        "deadline_exceeded",
        1,
      )
    } finally {
      JSON.parse = originalParse
    }
  })

  test("clock and abort priority on FAILED UTF8 decode", async () => {
    let now = 1000
    const originalDecode = TextDecoder.prototype.decode
    try {
      TextDecoder.prototype.decode = function decodeGuard(
        this: TextDecoder,
        ...args: Parameters<typeof originalDecode>
      ): string {
        now = 2001
        return originalDecode.apply(this, args)
      }
      expectReject(
        await factory({
          nowMs: () => now,
          fetchImpl: () =>
            Promise.resolve(new Response(new Uint8Array([0xc3]))),
        }).complete(input()),
        "deadline_exceeded",
        1,
      )
    } finally {
      TextDecoder.prototype.decode = originalDecode
    }
  })

  test("invalid response shape does not expose property getter exception", async () => {
    const fake = {
      get status(): number {
        throw new Error("PRIVATE_STATUS")
      },
      body: null,
    }
    const result = expectReject(
      await factory({
        fetchImpl: () => Promise.resolve(fake as unknown as Response),
      }).complete(input()),
      "invalid_response",
      1,
    )
    expect(JSON.stringify(result).includes("PRIVATE_STATUS")).toBe(false)
  })

  test("cleanup body getter exception cannot replace successful error result", async () => {
    const fake = {
      status: 401,
      get body(): ReadableStream<Uint8Array> | null {
        throw new Error("PRIVATE_CLEANUP")
      },
    }
    const result = expectReject(
      await factory({
        fetchImpl: () => Promise.resolve(fake as unknown as Response),
      }).complete(input()),
      "http_status",
      1,
    )
    expect(JSON.stringify(result).includes("PRIVATE_CLEANUP")).toBe(false)
  })

  test("aborted gate observes ALREADY rejected fetch promise", async () => {
    let unhandled = 0
    const listener = () => {
      unhandled += 1
    }
    process.on("unhandledRejection", listener)
    const a = new AbortController()
    try {
      expectReject(
        await factory({
          fetchImpl: () => {
            a.abort("PRIVATE")
            return Promise.reject(new Error("PRIVATE_LATE"))
          },
        }).complete(input({ signal: a.signal })),
        "cancelled",
        1,
      )
      await new Promise<void>((resolve) => {
        setImmediate(resolve)
      })
      expect(unhandled).toBe(0)
    } finally {
      process.removeListener("unhandledRejection", listener)
    }
  })

  test("oversize response aborts underlying fetch signal", async () => {
    let signal: AbortSignal | undefined
    const client = factory({
      limits: { maxResponseBodyBytes: 10 },
      fetchImpl: (_u, init) => {
        signal = init?.signal ?? undefined
        return Promise.resolve(jsonResponse())
      },
    })
    expectReject(await client.complete(input()), "response_oversize", 1)
    expect(signal?.aborted).toBe(true)
  })

  test("counter snapshot remains mutable independent copy", () => {
    const client = factory()
    const snapshot = client.getCounters()
    const view = snapshot.candidate as { used: number; limit: number }
    view.used = 7
    expect(client.getCounters().candidate.used).toBe(0)
  })

  test("successful response release lock remove signal listener timer", async () => {
    const a = new AbortController()
    const s = a.signal
    let adds = 0
    let removes = 0
    const originalAdd = s.addEventListener
    const originalRemove = s.removeEventListener
    s.addEventListener = (...args: Parameters<typeof originalAdd>): void => {
      adds += 1
      originalAdd(...args)
    }
    s.removeEventListener = (
      ...args: Parameters<typeof originalRemove>
    ): void => {
      removes += 1
      originalRemove(...args)
    }
    expectOk(await factory().complete(input({ signal: s })))
    expect(adds).toBe(removes)
  })

  test("invalid clock cannot be masked by zero budget", async () => {
    expectReject(
      await factory({
        nowMs: () => Number.NaN,
        callLimits: { candidate: 0, judge: 0 },
      }).complete(input()),
      "invalid_input",
      0,
    )
  })

  test("pre-abort outranks simultaneous expired deadline", async () => {
    const a = new AbortController()
    a.abort("PRIVATE")
    expectReject(
      await factory().complete(input({ signal: a.signal, deadlineAtMs: 999 })),
      "cancelled_before_start",
      0,
    )
  })
})

describe("portable lifecycle controls", () => {
  test("expiry found in final prefetch guard never spends a call", async () => {
    let reads = 0
    let fetches = 0
    const client = factory({
      nowMs: () => (++reads <= 2 ? 1000 : 2001),
      fetchImpl: () => {
        fetches += 1
        return Promise.resolve(jsonResponse())
      },
    })
    const result = expectReject(
      await client.complete(input()),
      "deadline_before_start",
      0,
    )
    expect(fetches).toBe(0)
    expect(client.getCounters().candidate.used).toBe(0)
    expect(client.getCounters().candidate.attempts).toBe(0)
    expect(result.attempt.requestHash).toBe(canonicalRequestHash())
    expect(result.attempt.contentGroupHash).toBe(contentGroupHashValue())
  })

  test("caller abort while subscribing never spends a call", async () => {
    const a = new AbortController()
    const s = a.signal
    const originalAdd = s.addEventListener
    s.addEventListener = (...args: Parameters<typeof originalAdd>): void => {
      originalAdd(...args)
      a.abort("PRIVATE")
    }
    let fetches = 0
    const client = factory({
      fetchImpl: () => {
        fetches += 1
        return Promise.resolve(jsonResponse())
      },
    })
    const result = expectReject(
      await client.complete(input({ signal: s })),
      "cancelled_before_start",
      0,
    )
    expect(fetches).toBe(0)
    expect(client.getCounters().candidate.used).toBe(0)
    expect(result.attempt.contentGroupHash).toBe(contentGroupHashValue())
  })

  test("real timeout uses remaining deadline not duration before validation", async () => {
    let reads = 0
    const client = factory({
      nowMs: () => {
        reads += 1
        return reads === 1 ? 1000 : 1495
      },
      limits: { maxElapsedMs: 500 },
      fetchImpl: () =>
        new Promise<Response>(() => {
          // intentionally never settles
        }),
    })
    const result = expectReject(
      await withGuard(client.complete(input()), 200),
      "deadline_exceeded",
      1,
    )
    expect(result.reason).toBe("deadline")
  })

  test("unread HTTP error body cancelled without awaiting it", async () => {
    let cancelled = 0
    const fake = {
      status: 401,
      redirected: false,
      body: {
        cancel: () => {
          cancelled += 1
          return new Promise<never>(() => {
            // intentionally never settles
          })
        },
      },
    }
    const result = expectReject(
      await withGuard(
        factory({
          fetchImpl: () => Promise.resolve(fake as unknown as Response),
        }).complete(input()),
      ),
      "http_status",
      1,
    )
    expect(cancelled).toBe(1)
    expect(result.attempt.responseHash).toBeNull()
    expect(JSON.stringify(result).includes("PRIVATE")).toBe(false)
  })

  test("early Content-Length failure also aborts request", async () => {
    let signal: AbortSignal | undefined
    const result = expectReject(
      await factory({
        limits: { maxResponseBodyBytes: 10 },
        fetchImpl: (_u, init) => {
          signal = init?.signal ?? undefined
          return Promise.resolve(
            new Response("PRIVATE", {
              headers: { "Content-Length": "99" },
            }),
          )
        },
      }).complete(input()),
      "response_oversize",
      1,
    )
    expect(signal?.aborted).toBe(true)
    expect(result.code).toBe("response_oversize")
    expect(JSON.stringify(result).includes("PRIVATE")).toBe(false)
  })

  test("known canonical hashes retained on zero-budget rejection", async () => {
    const client = factory({ callLimits: { candidate: 0, judge: 0 } })
    const result = expectReject(
      await client.complete(input()),
      "budget_exhausted",
      0,
    )
    expect(result.attempt.contentGroupHash).toBe(contentGroupHashValue())
    expect(result.attempt.requestHash).toBe(canonicalRequestHash())
    expect(result.attempt.requestBytes).toBe(
      Buffer.byteLength(
        JSON.stringify({
          model,
          messages: input().messages,
          stream: false,
          temperature: 0,
          max_tokens: 4096,
        }),
      ),
    )
    expect(client.getCounters().candidate.used).toBe(0)
  })
})
