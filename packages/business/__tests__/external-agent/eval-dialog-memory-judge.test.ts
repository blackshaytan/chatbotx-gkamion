import { createHash } from "node:crypto"
import type { DialogMemoryMessageDto } from "@chatbotx.io/database/repositories"
import { describe, expect, test } from "vitest"
import type {
  MemoryPayload,
  MemoryValidationOptions,
} from "../../../../packages/business/src/external-agent/memory-contract"
import {
  buildJudgeRequest,
  JUDGE_MAX_ENCODED_CHARS,
  JUDGE_MAX_RESPONSE_UTF8_BYTES,
  JUDGE_MAX_UTF8_BYTES,
  JUDGE_PROTOCOL_VERSION,
  JUDGE_REJECT_CODES,
  JUDGE_RESPONSE_FORMAT_TEXT,
  JUDGE_SYSTEM_TEXT,
  type JudgeDecision,
  type JudgeRequestResult,
  parseJudgeResponse,
} from "../../../../scripts/lib/eval-dialog-memory-judge"

const scope = {
  workspaceId: "1",
  conversationId: "2",
  expectedContactId: "4",
}

const stamp = "2026-01-02T03:04:05.123456Z"

const options: MemoryValidationOptions = { nowMs: () => 1000 }

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex")

const dto = (
  extra: Partial<DialogMemoryMessageDto> = {},
): DialogMemoryMessageDto => ({
  id: "9007199254740993",
  createdAtMicros: stamp,
  updatedAtMicros: stamp,
  workspaceId: "1",
  conversationId: "2",
  contactInboxId: "3",
  text: "Не оплатил. Сумма 125.00 RUB.",
  contentAttributes: null,
  messageType: "incoming",
  contentType: "text",
  senderType: "contact",
  senderId: "4",
  sourceId: null,
  deletedAtMicros: null,
  type: "message",
  parentId: null,
  attributes: null,
  sendError: null,
  attachments: [],
  ...extra,
})

const payload = (
  message: DialogMemoryMessageDto = dto(),
  quote: string = message.text ?? "",
): MemoryPayload => ({
  version: 1,
  facts: [
    {
      attribution: "contact",
      quotes: [
        {
          ref: {
            id: message.id,
            createdAtMicros: message.createdAtMicros,
          },
          text: quote,
        },
      ],
    },
  ],
  narrative: {
    text: "Клиент сообщил, что не оплатил.",
    nonAuthoritative: true,
  },
  openQuestions: [],
})

const input = (extra: Record<string, unknown> = {}) => ({
  sourceEvidence: [dto()] as readonly DialogMemoryMessageDto[],
  candidatePayload: payload() as unknown,
  scope: { ...scope },
  deadlineAtMs: 2000,
  ...extra,
})

const build = (
  extra: Record<string, unknown> = {},
  opts: MemoryValidationOptions = options,
) => buildJudgeRequest(input(extra), opts) as JudgeRequestResult

const parse = (raw: unknown) => parseJudgeResponse(raw)

const expectReject = (
  result: { kind: string; reason?: string; sourceReason?: string },
  reason: string,
  sourceReason?: string,
) => {
  expect(result.kind).toBe("reject")
  expect(result.reason).toBe(reason)
  if (sourceReason !== undefined) {
    expect(result.sourceReason).toBe(sourceReason)
  }
}

const decision = (verdict: string, codes: readonly string[]): string =>
  JSON.stringify({ version: 1, verdict, codes })

describe("runtime surface", () => {
  test("exports exact nine runtime values", () => {
    expect(JUDGE_PROTOCOL_VERSION).toBe("t08-judge-v1")
    expect(JUDGE_MAX_ENCODED_CHARS).toBe(64_000)
    expect(JUDGE_MAX_UTF8_BYTES).toBe(131_072)
    expect(JUDGE_MAX_RESPONSE_UTF8_BYTES).toBe(8192)
    expect(JUDGE_REJECT_CODES).toHaveLength(8)
    expect(typeof buildJudgeRequest).toBe("function")
    expect(typeof parseJudgeResponse).toBe("function")
  })

  test("frozen prompt literals match pinned hashes", () => {
    expect(sha256(JUDGE_SYSTEM_TEXT)).toBe(
      "3c2df691365b3688d60a2ae11f30e9c914adeef9dcb78089dcb03cd9a3ee81b9",
    )
    expect(sha256(JUDGE_RESPONSE_FORMAT_TEXT)).toBe(
      "707cf4a7200e6ea31a24c2df4ba9b6f82c1e361b28533d77f645dcbb9caf591e",
    )
  })
})

describe("buildJudgeRequest", () => {
  test("valid request returns exactly two messages and whitelist view", () => {
    const result = build()
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }

    expect(result.messages).toHaveLength(2)
    expect(result.messages[0].role).toBe("system")
    expect(result.messages[0].content).toBe(
      `${JUDGE_SYSTEM_TEXT}\n\n${JUDGE_RESPONSE_FORMAT_TEXT}`,
    )
    expect(result.messages[1].role).toBe("user")

    const data = JSON.parse(result.messages[1].content)
    expect(Object.keys(data).sort()).toEqual([
      "candidatePayload",
      "sourceMessages",
    ])
    expect(data.sourceMessages).toHaveLength(1)
    expect(Object.keys(data.sourceMessages[0]).sort()).toEqual([
      "attachments",
      "attribution",
      "createdAtMicros",
      "id",
      "text",
    ])
    expect(data.sourceMessages[0].id).toBe("9007199254740993")
    expect(data.sourceMessages[0].attribution).toBe("contact")

    const wire = JSON.stringify({ messages: result.messages })
    expect(result.totalEncodedChars).toBe(wire.length)
    expect(result.totalUtf8Bytes).toBe(Buffer.byteLength(wire, "utf8"))
  })

  test("full source history survives without delivery window cut", () => {
    const fresh = dto({
      id: "11",
      createdAtMicros: "2026-01-03T03:04:05.123456Z",
      text: "Новый вопрос",
    })
    const result = build({ sourceEvidence: [dto(), fresh] })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }
    const data = JSON.parse(result.messages[1].content)
    expect(data.sourceMessages.map((m: { text: string }) => m.text)).toEqual([
      "Не оплатил. Сумма 125.00 RUB.",
      "Новый вопрос",
    ])
  })

  test("tombstone is omitted from sourceMessages when not quoted", () => {
    const dead = dto({
      id: "12",
      deletedAtMicros: stamp,
      text: "PRIVATE_DELETED_TEXT",
    })
    const result = build({ sourceEvidence: [dto(), dead] })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }
    const data = JSON.parse(result.messages[1].content)
    expect(data.sourceMessages).toHaveLength(1)
    expect(result.messages[1].content).not.toContain("PRIVATE_DELETED_TEXT")
  })

  test("candidate reference to deleted source is rejected", () => {
    const dead = dto({ deletedAtMicros: stamp })
    expectReject(
      build({ sourceEvidence: [dead], candidatePayload: payload(dead) }),
      "validation_rejected",
      "ref_ineligible",
    )
  })

  test("comment is omitted and activity messageType alone is not excluded", () => {
    const comment = dto({
      id: "13",
      type: "comment",
      text: "PRIVATE_COMMENT",
    })
    const activity = dto({
      id: "14",
      messageType: "activity",
      text: "Activity retained by T07 rule",
    })
    const result = build({ sourceEvidence: [dto(), comment, activity] })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }
    const data = JSON.parse(result.messages[1].content)
    expect(data.sourceMessages).toHaveLength(2)
    expect(data.sourceMessages.some((m: { id: string }) => m.id === "14")).toBe(
      true,
    )
    expect(JSON.stringify(data)).not.toContain("PRIVATE_COMMENT")
  })

  test("literal rubric words and URLs remain legitimate source data", () => {
    const message = dto({
      text: "requiredEvidence https://example.invalid/ 125.00 RUB HNQ4O51GQ",
    })
    const result = build({
      sourceEvidence: [message],
      candidatePayload: payload(message),
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }
    const data = JSON.parse(result.messages[1].content)
    expect(data.sourceMessages[0].text).toBe(message.text)
  })

  test("candidate Proxy is rejected with zero traps", () => {
    let calls = 0
    const proxy = new Proxy(
      {},
      {
        get() {
          calls++
          throw new Error("TRAP")
        },
        getPrototypeOf() {
          calls++
          throw new Error("TRAP")
        },
        ownKeys() {
          calls++
          throw new Error("TRAP")
        },
      },
    )
    expectReject(
      build({ candidatePayload: proxy }),
      "validation_rejected",
      "not_plain_json",
    )
    expect(calls).toBe(0)
  })

  test("revoked candidate Proxy does not throw", () => {
    const revocable = Proxy.revocable({}, {})
    revocable.revoke()
    expectReject(
      build({ candidatePayload: revocable.proxy }),
      "validation_rejected",
      "not_plain_json",
    )
  })

  test("source DTO Proxy is rejected without reflection", () => {
    let calls = 0
    const proxy = new Proxy(dto(), {
      get() {
        calls++
        throw new Error("TRAP")
      },
      getPrototypeOf() {
        calls++
        throw new Error("TRAP")
      },
      ownKeys() {
        calls++
        throw new Error("TRAP")
      },
    })
    expectReject(
      build({ sourceEvidence: [proxy] }),
      "validation_rejected",
      "not_plain_json",
    )
    expect(calls).toBe(0)
  })

  test("revoked source array Proxy is rejected without IsArray error", () => {
    const revocable = Proxy.revocable([], {})
    revocable.revoke()
    expectReject(
      build({ sourceEvidence: revocable.proxy }),
      "validation_rejected",
      "not_plain_json",
    )
  })

  test("extra caller getter fields are not read or serialized", () => {
    let calls = 0
    const request = {
      sourceEvidence: [dto()] as readonly DialogMemoryMessageDto[],
      candidatePayload: payload() as unknown,
      scope: { ...scope },
      deadlineAtMs: 2000,
    }
    Object.defineProperty(request, "graderEnvelope", {
      enumerable: true,
      get() {
        calls++
        throw new Error("PRIVATE_GETTER")
      },
    })

    const result = buildJudgeRequest(request, options)
    expect(result.kind).toBe("ok")
    expect(calls).toBe(0)
    if (result.kind === "ok") {
      expect(JSON.stringify(result.messages)).not.toContain("graderEnvelope")
    }
  })

  test("unquoted foreign scope source is rejected across full snapshot", () => {
    expectReject(
      build({
        sourceEvidence: [dto(), dto({ id: "15", conversationId: "99" })],
      }),
      "validation_rejected",
      "scope_mismatch",
    )
  })

  test("forged role is rejected before packet", () => {
    const forged = payload()
    forged.facts[0].attribution = "staff"
    expectReject(
      build({ candidatePayload: forged }),
      "validation_rejected",
      "role_forged",
    )
  })

  test("changed amount quote is rejected before packet", () => {
    const changed = payload()
    changed.facts[0].quotes[0].text = "125.01"
    expectReject(
      build({ candidatePayload: changed }),
      "validation_rejected",
      "quote_mismatch",
    )
  })

  test("candidatePayload 123 rejects as schema_mismatch and toJSON never coerces", () => {
    const numeric = build({ candidatePayload: 123 })
    expect(numeric.kind).toBe("reject")
    if (numeric.kind === "reject") {
      expect(numeric.reason).toBe("validation_rejected")
      expect(numeric.sourceReason).toBe("schema_mismatch")
    }

    let calls = 0
    const withToJson = {
      toJSON() {
        calls++
        throw new Error("TOJSON")
      },
    }
    expect(build({ candidatePayload: withToJson }).kind).toBe("reject")
    expect(calls).toBe(0)
  })

  test("char budget exact N accepts and N-1 oversizes", () => {
    const result = build()
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }
    expect(
      build({ budget: { maxEncodedChars: result.totalEncodedChars } }).kind,
    ).toBe("ok")
    expect(
      build({ budget: { maxEncodedChars: result.totalEncodedChars - 1 } }),
    ).toEqual({ kind: "oversize" })
  })

  test("byte budget exact N accepts and N-1 oversizes", () => {
    const result = build()
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }
    expect(
      build({ budget: { maxUtf8Bytes: result.totalUtf8Bytes } }).kind,
    ).toBe("ok")
    expect(
      build({ budget: { maxUtf8Bytes: result.totalUtf8Bytes - 1 } }),
    ).toEqual({ kind: "oversize" })
  })

  test("invalid trusted budgets throw RangeError", () => {
    for (const budget of [
      { maxEncodedChars: 64_001 },
      { maxUtf8Bytes: 131_073 },
      { maxEncodedChars: 0 },
      { maxEncodedChars: -1 },
      { maxUtf8Bytes: 1.5 },
    ]) {
      expect(() => build({ budget })).toThrow(RangeError)
    }
  })

  test("invalid budget value never coerced into RangeError message", () => {
    let calls = 0
    const value = {
      toString() {
        calls++
        throw new Error("PRIVATE_CONFIG_ECHO")
      },
    }
    expect(() => build({ budget: { maxEncodedChars: value } })).toThrow(
      RangeError,
    )
    expect(calls).toBe(0)
  })

  test("budget known accessor fields throw RangeError without getters", () => {
    let charsCalls = 0
    const charsBudget = {}
    Object.defineProperty(charsBudget, "maxEncodedChars", {
      enumerable: true,
      get() {
        charsCalls++
        throw new Error("CONFIG_GETTER")
      },
    })
    expect(() => build({ budget: charsBudget })).toThrow(RangeError)
    expect(charsCalls).toBe(0)

    let bytesCalls = 0
    const bytesBudget = {}
    Object.defineProperty(bytesBudget, "maxUtf8Bytes", {
      enumerable: true,
      get() {
        bytesCalls++
        throw new Error("CONFIG_GETTER")
      },
    })
    expect(() => build({ budget: bytesBudget })).toThrow(RangeError)
    expect(bytesCalls).toBe(0)
  })

  test("deadline in the past and aborted signal propagate", () => {
    expectReject(build({ deadlineAtMs: 999 }), "deadline")
    const controller = new AbortController()
    controller.abort()
    expectReject(build({ signal: controller.signal }), "cancelled")
  })

  test("injected clock is used everywhere and Date.now is never called", () => {
    const original = Date.now
    let calls = 0
    try {
      Date.now = () => {
        calls++
        throw new Error("WRONG_CLOCK")
      }
      expect(build().kind).toBe("ok")
      expect(calls).toBe(0)
    } finally {
      Date.now = original
    }
  })

  test("lower T07 source limits are forwarded", () => {
    expectReject(
      build(
        { sourceEvidence: [dto(), dto({ id: "16" })] },
        { nowMs: () => 1000, limits: { maxSourceItems: 1 } },
      ),
      "validation_rejected",
      "source_too_many_items",
    )
  })

  test("result detaches from caller mutations", () => {
    const message = dto()
    const candidate = payload(message)
    const result = build({
      sourceEvidence: [message],
      candidatePayload: candidate,
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }
    const before = JSON.stringify(result)
    message.text = "MUTATED"
    candidate.narrative.text = "MUTATED"
    candidate.facts[0].quotes[0].ref.id = "999"
    expect(JSON.stringify(result)).toBe(before)
  })

  test("judge budget is not T07 24000 chars and full text is not clipped", () => {
    const message = dto({ text: `Да${"x".repeat(28_000)}` })
    const result = build({
      sourceEvidence: [message],
      candidatePayload: payload(message, "Да"),
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }
    expect(result.totalEncodedChars).toBeGreaterThan(24_000)
    const data = JSON.parse(result.messages[1].content)
    expect(data.sourceMessages[0].text).toBe(message.text)
  })

  test("malformed input boundaries reject safely", () => {
    expectReject(buildJudgeRequest(null as unknown as never), "invalid_input")
    expectReject(
      build({ sourceEvidence: "not-an-array" as unknown as never }),
      "invalid_input",
    )
    expectReject(
      build({ deadlineAtMs: 1.5 as unknown as never }),
      "invalid_input",
    )
    expectReject(
      build({ signal: {} as unknown as AbortSignal }),
      "invalid_input",
    )

    let calls = 0
    const proxyInput = new Proxy(
      {},
      {
        get() {
          calls++
          throw new Error("TRAP")
        },
      },
    )
    expectReject(
      buildJudgeRequest(proxyInput as unknown as never),
      "invalid_input",
    )
    expect(calls).toBe(0)
  })
})

describe("parseJudgeResponse", () => {
  test("non-string response rejects without toJSON or Proxy traps", () => {
    let calls = 0
    const proxy = new Proxy(
      {},
      {
        get() {
          calls++
          throw new Error("TRAP")
        },
      },
    )
    for (const raw of [
      123,
      proxy,
      {
        toJSON: () => {
          calls++
          throw new Error("TOJSON")
        },
      },
    ]) {
      expectReject(parse(raw), "response_invalid")
    }
    expect(calls).toBe(0)
  })

  test("response byte cap is enforced before parse", () => {
    expectReject(parse(" ".repeat(8193)), "response_oversize")

    const base = decision("pass", ["faithful"])
    const within = `${base}${" ".repeat(8192 - Buffer.byteLength(base, "utf8"))}`
    const result = parse(within)
    expect(result.kind).toBe("ok")

    const over = `${base}${" ".repeat(8193 - Buffer.byteLength(base, "utf8"))}`
    expectReject(parse(over), "response_oversize")
  })

  test("invalid JSON wrappers, arrays and scalars reject", () => {
    for (const raw of [
      "",
      "```json\n{}\n```",
      "42",
      "null",
      "[]",
      "true",
      "{} trailing",
    ]) {
      expectReject(parse(raw), "response_invalid")
    }
  })

  test("wrong version, private extras and unknown codes reject", () => {
    for (const raw of [
      { version: 2, verdict: "pass", codes: ["faithful"] },
      { version: 1, verdict: "pass", codes: ["faithful"], rationale: "PII" },
      { version: 1, verdict: "reject", codes: ["invented"] },
    ]) {
      expectReject(parse(JSON.stringify(raw)), "response_invalid")
    }
  })

  test("cross-field contradictions reject", () => {
    for (const [verdict, codes] of [
      ["pass", ["faithful", "critical_omission"]],
      ["inconclusive", ["uncertain", "faithful"]],
      ["reject", []],
      ["reject", ["unsupported_claim", "unsupported_claim"]],
      ["reject", ["faithful"]],
      ["pass", ["uncertain"]],
    ] as const) {
      expectReject(parse(decision(verdict, codes)), "response_invalid")
    }
  })

  test("valid pass decision parses form only", () => {
    const result = parse(decision("pass", ["faithful"]))
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.decision).toEqual({
        verdict: "pass",
        codes: ["faithful"],
      })
    }
  })

  test("valid reject decision parses form only", () => {
    const result = parse(
      decision("reject", ["unsupported_claim", "negation_changed"]),
    )
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.decision).toEqual({
        verdict: "reject",
        codes: ["unsupported_claim", "negation_changed"],
      })
    }
  })

  test("valid inconclusive remains separate from pass", () => {
    const result = parse(decision("inconclusive", ["uncertain"]))
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.decision).toEqual({
        verdict: "inconclusive",
        codes: ["uncertain"],
      })
    }
  })

  test("eight distinct reject codes are accepted", () => {
    const codes = [...JUDGE_REJECT_CODES]
    const result = parse(decision("reject", codes))
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect((result.decision as JudgeDecision).verdict).toBe("reject")
      expect(result.decision.codes).toHaveLength(8)
    }
  })
})
