import type { DialogMemoryMessageDto } from "@chatbotx.io/database/repositories"
import { describe, expect, test } from "vitest"
import {
  type AttributionKind,
  type MemoryPayload,
  VALIDATION_LIMITS,
  type ValidationFailCode,
} from "../../src/external-agent/memory-contract"
import {
  checkPriorQuoteRetention,
  createDialogMemoryValidator,
  deriveAttribution,
  parseMemoryPayload,
  prepareMemorySources,
} from "../../src/external-agent/memory-validation"

const scope = {
  workspaceId: "1",
  conversationId: "2",
  expectedContactId: "4",
}

const stamp = "2026-01-02T03:04:05.123456Z"
const text = "Клиент сообщил о переводе 125.00 RUB. Это его заявление."

const baseDto = (): DialogMemoryMessageDto => ({
  id: "9007199254740993",
  createdAtMicros: stamp,
  updatedAtMicros: stamp,
  workspaceId: "1",
  conversationId: "2",
  contactInboxId: "3",
  text,
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
})

const basePayload = (
  m: DialogMemoryMessageDto = baseDto(),
  attribution: AttributionKind = "contact",
) => ({
  version: 1 as const,
  facts: [
    {
      attribution,
      quotes: [
        {
          ref: { id: m.id, createdAtMicros: m.createdAtMicros },
          text: m.text ?? "",
        },
      ],
    },
  ],
  narrative: {
    text: "Это пересказ, а не подтверждение банка.",
    nonAuthoritative: true as const,
  },
  openQuestions: [],
})

const expectReject = (
  result: { kind: string; reason?: string },
  code: ValidationFailCode | "prior_retention_violation",
) => {
  expect(result.kind).toBe("reject")
  expect(result.reason).toBe(code)
}

const makeValidator = () => createDialogMemoryValidator({ nowMs: () => 1000 })

const runValidate = async (
  candidatePayload: unknown = basePayload(),
  sourceEvidence: DialogMemoryMessageDto[] = [baseDto()],
  more: { deadlineAtMs?: number; signal?: AbortSignal } = {},
) =>
  makeValidator().validate({
    candidatePayload,
    sourceEvidence,
    scope: { ...scope },
    config: {
      schemaVersion: 1,
      promptVersion: "synthetic",
      provider: "synthetic",
      model: "synthetic",
    },
    deadlineAtMs: 2000,
    ...more,
  })

describe("deriveAttribution", () => {
  const cases: Array<{
    senderType: DialogMemoryMessageDto["senderType"]
    expected: AttributionKind
  }> = [
    { senderType: "contact", expected: "contact" },
    { senderType: "user", expected: "staff" },
    { senderType: "bot", expected: "automation" },
    { senderType: "api", expected: "automation" },
    { senderType: "system", expected: "unknown" },
    { senderType: "future_sender", expected: "unknown" },
  ]

  test.each(cases)("$senderType -> $expected", ({ senderType, expected }) => {
    const dto = baseDto()
    dto.senderType = senderType
    expect(deriveAttribution(dto)).toBe(expected)
  })
})

describe("parseMemoryPayload", () => {
  const opts = { nowMs: () => 1000, deadlineAtMs: 2000 }

  test("accepts a plain payload", () => {
    const result = parseMemoryPayload(basePayload(), opts)
    expect(result.kind).toBe("ok")
  })

  test("accepts a strict JSON string", () => {
    const result = parseMemoryPayload(JSON.stringify(basePayload()), opts)
    expect(result.kind).toBe("ok")
  })

  test("applies narrative and openQuestion defaults", () => {
    const payload = basePayload()
    Reflect.deleteProperty(payload, "narrative")
    Reflect.deleteProperty(payload, "openQuestions")
    const result = parseMemoryPayload(payload, opts)
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.payload.narrative).toEqual({
        text: "",
        nonAuthoritative: true,
      })
      expect(result.payload.openQuestions).toEqual([])
    }
  })

  test("rejects raw candidate larger than byte cap", () => {
    const result = parseMemoryPayload("x".repeat(100), {
      ...opts,
      limits: { maxCandidateUtf8Bytes: 50 },
    })
    expectReject(result, "oversize")
  })

  test("rejects truncated JSON", () => {
    const result = parseMemoryPayload('{"version":1,', opts)
    expectReject(result, "parse_failed")
  })

  test("rejects NUL after parse", () => {
    const payload = basePayload()
    payload.narrative.text = String.fromCharCode(0)
    const result = parseMemoryPayload(JSON.stringify(payload), opts)
    expectReject(result, "not_plain_json")
  })

  test("rejects lone surrogate after parse", () => {
    const payload = basePayload()
    payload.narrative.text = String.fromCharCode(0xd8_00)
    const result = parseMemoryPayload(JSON.stringify(payload), opts)
    expectReject(result, "not_plain_json")
  })

  test("does not execute candidate getter", () => {
    let calls = 0
    const payload = basePayload()
    Object.defineProperty(payload, "trap", {
      enumerable: true,
      get() {
        calls++
        throw new Error("GETTER")
      },
    })
    const result = parseMemoryPayload(payload, opts)
    expectReject(result, "not_plain_json")
    expect(calls).toBe(0)
  })

  test("does not execute toJSON", () => {
    let calls = 0
    const payload = basePayload()
    ;(payload as { toJSON?: () => unknown }).toJSON = () => {
      calls++
      throw new Error("TOJSON")
    }
    const result = parseMemoryPayload(payload, opts)
    expectReject(result, "not_plain_json")
    expect(calls).toBe(0)
  })

  test("rejects proxy without touching traps", () => {
    let calls = 0
    const trap = () => {
      calls++
      throw new Error("PROXY")
    }
    const payload = new Proxy(basePayload(), {
      get: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
      getOwnPropertyDescriptor: trap,
    })
    const result = parseMemoryPayload(payload, opts)
    expectReject(result, "not_plain_json")
    expect(calls).toBe(0)
  })

  test("rejects revoked proxy", () => {
    const revocable = Proxy.revocable(basePayload(), {})
    revocable.revoke()
    const result = parseMemoryPayload(revocable.proxy, opts)
    expectReject(result, "not_plain_json")
  })

  test("rejects array subclass", () => {
    const payload = basePayload()
    class BadArray extends Array {}
    payload.facts = Object.setPrototypeOf(
      [...payload.facts],
      BadArray.prototype,
    ) as unknown as typeof payload.facts
    const result = parseMemoryPayload(payload, opts)
    expectReject(result, "not_plain_json")
  })

  test("rejects sparse array", () => {
    const payload = basePayload()
    payload.facts.length = 3
    const result = parseMemoryPayload(payload, opts)
    expectReject(result, "not_plain_json")
  })

  test("rejects symbol key", () => {
    const payload = basePayload()
    ;(payload as Record<symbol, unknown>)[Symbol("secret")] = 1
    const result = parseMemoryPayload(payload, opts)
    expectReject(result, "not_plain_json")
  })

  test("rejects cyclic object", () => {
    const payload = basePayload() as { cycle?: unknown }
    payload.cycle = payload
    const result = parseMemoryPayload(payload, opts)
    expectReject(result, "not_plain_json")
  })

  test("rejects depth beyond limit", () => {
    const deep = {
      version: 1,
      facts: [] as unknown[],
      narrative: { text: "", nonAuthoritative: true },
      openQuestions: [],
    }
    let current: unknown = deep.facts
    for (let i = 0; i < VALIDATION_LIMITS.maxNodeDepth + 1; i++) {
      const next: unknown[] = []
      ;(current as unknown[]).push(next)
      current = next
    }
    const result = parseMemoryPayload(deep, opts)
    expectReject(result, "not_plain_json")
  })

  test("rejects too many nodes", () => {
    const payload = {
      version: 1,
      facts: Array.from(
        { length: VALIDATION_LIMITS.maxNodesTotal + 1 },
        () => ({
          attribution: "contact",
          quotes: [{ ref: { id: "1", createdAtMicros: stamp }, text: "x" }],
        }),
      ),
      narrative: { text: "", nonAuthoritative: true },
      openQuestions: [],
    }
    const result = parseMemoryPayload(payload, opts)
    expectReject(result, "not_plain_json")
  })

  test("rejects expired deadline", () => {
    const result = parseMemoryPayload(basePayload(), {
      ...opts,
      deadlineAtMs: 999,
    })
    expectReject(result, "deadline")
  })

  test("rejects aborted signal", () => {
    const controller = new AbortController()
    controller.abort()
    const result = parseMemoryPayload(basePayload(), {
      ...opts,
      signal: controller.signal,
    })
    expectReject(result, "cancelled")
  })
})

describe("prepareMemorySources", () => {
  const opts = { nowMs: () => 1000 }

  test("accepts a single valid source", () => {
    const result = prepareMemorySources(
      { sourceEvidence: [baseDto()], scope: { ...scope }, deadlineAtMs: 2000 },
      opts,
    )
    expect(result.kind).toBe("ok")
  })

  test("source text larger than candidate cap is still eligible", () => {
    const dto = baseDto()
    dto.text = "x".repeat(70_000)
    const result = prepareMemorySources(
      { sourceEvidence: [dto], scope: { ...scope }, deadlineAtMs: 2000 },
      opts,
    )
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.sources[0].text).toHaveLength(70_000)
    }
  })

  test("rejects too many source items", () => {
    const a = baseDto()
    const b = baseDto()
    b.id = "11"
    const result = prepareMemorySources(
      { sourceEvidence: [a, b], scope: { ...scope }, deadlineAtMs: 2000 },
      { ...opts, limits: { maxSourceItems: 1 } },
    )
    expectReject(result, "source_too_many_items")
  })

  test("rejects projected source bytes beyond cap", () => {
    const dto = baseDto()
    dto.text = "x".repeat(2000)
    const result = prepareMemorySources(
      { sourceEvidence: [dto], scope: { ...scope }, deadlineAtMs: 2000 },
      { ...opts, limits: { maxSourceProjectedUtf8Bytes: 1000 } },
    )
    expectReject(result, "source_oversize")
  })

  test("does not touch source array proxy traps", () => {
    let calls = 0
    const trap = () => {
      calls++
      throw new Error("SOURCE_ARRAY_PROXY")
    }
    const evidence = new Proxy([baseDto()], {
      get: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
      getOwnPropertyDescriptor: trap,
    }) as unknown as DialogMemoryMessageDto[]
    const result = prepareMemorySources(
      { sourceEvidence: evidence, scope: { ...scope }, deadlineAtMs: 2000 },
      opts,
    )
    expectReject(result, "not_plain_json")
    expect(calls).toBe(0)
  })

  test("does not touch source message proxy traps", () => {
    let calls = 0
    const trap = () => {
      calls++
      throw new Error("SOURCE_PROXY")
    }
    const dto = new Proxy(baseDto(), {
      get: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
      getOwnPropertyDescriptor: trap,
    }) as unknown as DialogMemoryMessageDto
    const result = prepareMemorySources(
      { sourceEvidence: [dto], scope: { ...scope }, deadlineAtMs: 2000 },
      opts,
    )
    expectReject(result, "not_plain_json")
    expect(calls).toBe(0)
  })

  test("preserves nullable attachment name", () => {
    const dto = baseDto()
    dto.attachments = [
      {
        id: "31",
        createdAtMicros: stamp,
        updatedAtMicros: stamp,
        workspaceId: dto.workspaceId,
        conversationId: dto.conversationId,
        messageId: dto.id,
        messageCreatedAtMicros: dto.createdAtMicros,
        fileType: "image",
        sourceId: null,
        mimeType: "image/png",
        width: null,
        height: null,
        size: 1,
        thumbnailPath: null,
        originPath: "PRIVATE_STORAGE_SENTINEL",
        name: null,
      },
    ]
    const result = prepareMemorySources(
      { sourceEvidence: [dto], scope: { ...scope }, deadlineAtMs: 2000 },
      opts,
    )
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.sources[0].attachments[0].name).toBeNull()
      const serialized = JSON.stringify(result.sources)
      expect(serialized).not.toContain("PRIVATE_STORAGE_SENTINEL")
    }
  })

  test("rejects attachment with foreign workspace", () => {
    const dto = baseDto()
    dto.attachments = [
      {
        id: "31",
        createdAtMicros: stamp,
        updatedAtMicros: stamp,
        workspaceId: "99",
        conversationId: dto.conversationId,
        messageId: dto.id,
        messageCreatedAtMicros: dto.createdAtMicros,
        fileType: "image",
        sourceId: null,
        mimeType: "image/png",
        width: null,
        height: null,
        size: 1,
        thumbnailPath: null,
        originPath: "x",
        name: null,
      },
    ]
    const result = prepareMemorySources(
      { sourceEvidence: [dto], scope: { ...scope }, deadlineAtMs: 2000 },
      opts,
    )
    expectReject(result, "scope_mismatch")
  })

  test("rejects attachment with wrong parent id", () => {
    const dto = baseDto()
    dto.attachments = [
      {
        id: "31",
        createdAtMicros: stamp,
        updatedAtMicros: stamp,
        workspaceId: dto.workspaceId,
        conversationId: dto.conversationId,
        messageId: "99",
        messageCreatedAtMicros: dto.createdAtMicros,
        fileType: "image",
        sourceId: null,
        mimeType: "image/png",
        width: null,
        height: null,
        size: 1,
        thumbnailPath: null,
        originPath: "x",
        name: null,
      },
    ]
    const result = prepareMemorySources(
      { sourceEvidence: [dto], scope: { ...scope }, deadlineAtMs: 2000 },
      opts,
    )
    expectReject(result, "scope_mismatch")
  })

  test("keeps literal URLs and rubric words in text, omits metadata", () => {
    const dto = baseDto()
    dto.text = "requiredEvidence https://example.invalid/client-literal"
    dto.contentAttributes = { private: "METADATA_SENTINEL" }
    dto.sourceId = "SOURCEID_SENTINEL"
    const result = prepareMemorySources(
      { sourceEvidence: [dto], scope: { ...scope }, deadlineAtMs: 2000 },
      opts,
    )
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.sources[0].text).toBe(dto.text)
      const serialized = JSON.stringify(result.sources)
      expect(serialized).not.toContain("METADATA_SENTINEL")
      expect(serialized).not.toContain("SOURCEID_SENTINEL")
    }
  })

  test("prepared source and attachments are detached", () => {
    const dto = baseDto()
    dto.attachments = [
      {
        id: "31",
        createdAtMicros: stamp,
        updatedAtMicros: stamp,
        workspaceId: dto.workspaceId,
        conversationId: dto.conversationId,
        messageId: dto.id,
        messageCreatedAtMicros: dto.createdAtMicros,
        fileType: "image",
        sourceId: null,
        mimeType: "image/png",
        width: null,
        height: null,
        size: 1,
        thumbnailPath: null,
        originPath: "x",
        name: null,
      },
    ]
    const result = prepareMemorySources(
      { sourceEvidence: [dto], scope: { ...scope }, deadlineAtMs: 2000 },
      opts,
    )
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      dto.text = "tampered"
      dto.attachments[0].name = "tampered"
      expect(result.sources[0].text).toBe(text)
      expect(result.sources[0].attachments[0].name).toBeNull()
    }
  })

  test("rejects duplicate evidence full-refs", () => {
    const dto = baseDto()
    const result = prepareMemorySources(
      {
        sourceEvidence: [dto, { ...dto }],
        scope: { ...scope },
        deadlineAtMs: 2000,
      },
      opts,
    )
    expectReject(result, "ref_ambiguous")
  })
})

describe("validateMemoryPayload (factory)", () => {
  test("accepts a valid literal payload", async () => {
    const result = await runValidate()
    expect(result.kind).toBe("accept")
    if (result.kind === "accept") {
      expect((result.payload as MemoryPayload).narrative.nonAuthoritative).toBe(
        true,
      )
      expect((result.payload as MemoryPayload).facts[0].quotes[0].text).toBe(
        text,
      )
    }
  })

  test("accepts a strict JSON string", async () => {
    const result = await runValidate(JSON.stringify(basePayload()))
    expect(result.kind).toBe("accept")
  })

  test("rejects truncated JSON", async () => {
    expectReject(await runValidate('{"version":1,'), "parse_failed")
  })

  test("rejects fabricated full-ref", async () => {
    const payload = basePayload()
    payload.facts[0].quotes[0].ref.id = "99"
    expectReject(await runValidate(payload), "ref_not_found")
  })

  test("rejects same id with different microsecond", async () => {
    const payload = basePayload()
    payload.facts[0].quotes[0].ref.createdAtMicros =
      "2026-01-02T03:04:05.123457Z"
    expectReject(await runValidate(payload), "ref_not_found")
  })

  test("rejects changed monetary digit in quote", async () => {
    const payload = basePayload()
    payload.facts[0].quotes[0].text = text.replace("125.00", "126.00")
    expectReject(await runValidate(payload), "quote_mismatch")
  })

  test("rejects foreign workspace source", async () => {
    const dto = baseDto()
    dto.workspaceId = "9"
    expectReject(await runValidate(basePayload(dto), [dto]), "scope_mismatch")
  })

  test("rejects foreign conversation source", async () => {
    const dto = baseDto()
    dto.conversationId = "9"
    expectReject(await runValidate(basePayload(dto), [dto]), "scope_mismatch")
  })

  test("rejects contact claiming to be staff", async () => {
    expectReject(
      await runValidate(basePayload(baseDto(), "staff")),
      "role_forged",
    )
  })

  test("bot source is automation", async () => {
    const dto = baseDto()
    dto.senderType = "bot"
    expect(
      (await runValidate(basePayload(dto, "automation"), [dto])).kind,
    ).toBe("accept")
    expectReject(
      await runValidate(basePayload(dto, "staff"), [dto]),
      "role_forged",
    )
  })

  test("api source is automation", async () => {
    const dto = baseDto()
    dto.senderType = "api"
    expect(
      (await runValidate(basePayload(dto, "automation"), [dto])).kind,
    ).toBe("accept")
  })

  test("user source is staff", async () => {
    const dto = baseDto()
    dto.senderType = "user"
    expect((await runValidate(basePayload(dto, "staff"), [dto])).kind).toBe(
      "accept",
    )
  })

  test("unrecognized sender is unknown", async () => {
    const dto = baseDto()
    dto.senderType = "future_sender"
    expect((await runValidate(basePayload(dto, "unknown"), [dto])).kind).toBe(
      "accept",
    )
  })

  test("rejects mixed source attributions within a fact", async () => {
    const a = baseDto()
    const b = baseDto()
    b.id = "10"
    b.senderType = "user"
    const payload = basePayload(a)
    payload.facts[0].quotes.push({
      ref: { id: b.id, createdAtMicros: b.createdAtMicros },
      text: b.text ?? "",
    })
    expectReject(await runValidate(payload, [a, b]), "role_forged")
  })

  test("rejects deleted source", async () => {
    const dto = baseDto()
    dto.deletedAtMicros = stamp
    expectReject(await runValidate(basePayload(dto), [dto]), "ref_ineligible")
  })

  test("rejects comment source", async () => {
    const dto = baseDto()
    dto.type = "comment"
    expectReject(await runValidate(basePayload(dto), [dto]), "ref_ineligible")
  })

  test("rejects duplicate full-ref in evidence", async () => {
    const dto = baseDto()
    expectReject(
      await runValidate(basePayload(dto), [dto, { ...dto }]),
      "ref_ambiguous",
    )
  })

  test("accepts maximum positive PG bigint", async () => {
    const dto = baseDto()
    dto.id = "9223372036854775807"
    const result = await runValidate(basePayload(dto), [dto])
    expect(result.kind).toBe("accept")
    if (result.kind === "accept") {
      expect((result.payload as MemoryPayload).facts[0].quotes[0].ref.id).toBe(
        dto.id,
      )
    }
  })

  test("rejects id above PG bigint bound", async () => {
    const payload = basePayload()
    payload.facts[0].quotes[0].ref.id = "9223372036854775808"
    expectReject(await runValidate(payload), "schema_mismatch")
  })

  test("rejects numeric id", async () => {
    const payload = basePayload()
    ;(payload.facts[0].quotes[0].ref as { id: unknown }).id = 42
    expectReject(await runValidate(payload), "schema_mismatch")
  })

  test("rejects nonexistent February day", async () => {
    const payload = basePayload()
    payload.facts[0].quotes[0].ref.createdAtMicros =
      "2026-02-30T00:00:00.000000Z"
    expectReject(await runValidate(payload), "schema_mismatch")
  })

  test("rejects model-owned order link", async () => {
    const payload = basePayload() as { facts: { orderId?: string }[] }
    payload.facts[0].orderId = "OTHER_ORDER"
    expectReject(await runValidate(payload), "schema_mismatch")
  })

  test("rejects free fact prose", async () => {
    const payload = basePayload() as {
      facts: ({ text?: string } & Record<string, unknown>)[]
    }
    payload.facts[0].text = "Банк подтвердил оплату"
    expectReject(await runValidate(payload), "schema_mismatch")
  })

  test("rejects narrative claiming authoritative flag", async () => {
    const payload = basePayload()
    payload.narrative.nonAuthoritative = false as unknown as true
    expectReject(await runValidate(payload), "schema_mismatch")
  })

  test("rejects NUL after JSON parse", async () => {
    const payload = basePayload()
    payload.narrative.text = String.fromCharCode(0)
    expectReject(await runValidate(JSON.stringify(payload)), "not_plain_json")
  })

  test("rejects lone surrogate after JSON parse", async () => {
    const payload = basePayload()
    payload.narrative.text = String.fromCharCode(0xd8_00)
    expectReject(await runValidate(JSON.stringify(payload)), "not_plain_json")
  })

  test("does not execute candidate getter", async () => {
    let calls = 0
    const payload = basePayload()
    Object.defineProperty(payload, "trap", {
      enumerable: true,
      get() {
        calls++
        throw new Error("GETTER")
      },
    })
    expectReject(await runValidate(payload), "not_plain_json")
    expect(calls).toBe(0)
  })

  test("does not execute toJSON", async () => {
    let calls = 0
    const payload = basePayload()
    ;(payload as { toJSON?: () => unknown }).toJSON = () => {
      calls++
      throw new Error("TOJSON")
    }
    expectReject(await runValidate(payload), "not_plain_json")
    expect(calls).toBe(0)
  })

  test("rejects proxy without touching traps", async () => {
    let calls = 0
    const trap = () => {
      calls++
      throw new Error("PROXY")
    }
    const payload = new Proxy(basePayload(), {
      get: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
      getOwnPropertyDescriptor: trap,
    })
    expectReject(await runValidate(payload), "not_plain_json")
    expect(calls).toBe(0)
  })

  test("rejects revoked proxy", async () => {
    const revocable = Proxy.revocable(basePayload(), {})
    revocable.revoke()
    expectReject(await runValidate(revocable.proxy), "not_plain_json")
  })

  test("rejects array subclass", async () => {
    const payload = basePayload()
    class BadArray extends Array {}
    payload.facts = Object.setPrototypeOf(
      [...payload.facts],
      BadArray.prototype,
    ) as unknown as typeof payload.facts
    expectReject(await runValidate(payload), "not_plain_json")
  })

  test("rejects sparse array", async () => {
    const payload = basePayload()
    payload.facts.length = 3
    expectReject(await runValidate(payload), "not_plain_json")
  })

  test("rejects symbol key", async () => {
    const payload = basePayload()
    ;(payload as Record<symbol, unknown>)[Symbol("secret")] = 1
    expectReject(await runValidate(payload), "not_plain_json")
  })

  test("rejects cyclic object", async () => {
    const payload = basePayload() as { cycle?: unknown }
    payload.cycle = payload
    expectReject(await runValidate(payload), "not_plain_json")
  })

  test("rejects null text source as quote mismatch", async () => {
    const dto = baseDto()
    dto.text = null
    expectReject(await runValidate(basePayload(dto), [dto]), "quote_mismatch")
  })

  test("rejects expired deadline", async () => {
    expectReject(
      await runValidate(basePayload(), [baseDto()], { deadlineAtMs: 999 }),
      "deadline",
    )
  })

  test("rejects aborted signal", async () => {
    const controller = new AbortController()
    controller.abort()
    expectReject(
      await runValidate(basePayload(), [baseDto()], {
        signal: controller.signal,
      }),
      "cancelled",
    )
  })

  test("accepted payload is detached from candidate", async () => {
    const payload = basePayload()
    const result = await runValidate(payload)
    expect(result.kind).toBe("accept")
    payload.facts[0].quotes[0].text = "tampered"
    payload.narrative.text = "tampered"
    if (result.kind === "accept") {
      expect((result.payload as MemoryPayload).facts[0].quotes[0].text).toBe(
        text,
      )
      expect((result.payload as MemoryPayload).narrative.text).not.toBe(
        "tampered",
      )
    }
  })

  test("reject reason never echoes source secret", async () => {
    const payload = basePayload()
    payload.facts[0].quotes[0].text = "PRIVATE_SENTINEL_87654321"
    const result = await runValidate(payload)
    expectReject(result, "quote_mismatch")
    if (result.kind === "reject") {
      expect(result.reason).not.toContain("PRIVATE_SENTINEL")
    }
  })
})

describe("createDialogMemoryValidator factory", () => {
  test("rejects limit override beyond hard default", () => {
    expect(() =>
      createDialogMemoryValidator({
        limits: { maxFacts: 65 },
        nowMs: () => 1000,
      }),
    ).toThrow(RangeError)
  })

  test("captures limits without mutable aliases", async () => {
    const limits = { maxFacts: 1 }
    const validator = createDialogMemoryValidator({
      limits,
      nowMs: () => 1000,
    })
    limits.maxFacts = 64
    const payload = basePayload()
    payload.facts.push(structuredClone(payload.facts[0]))
    const result = await validator.validate({
      candidatePayload: payload,
      sourceEvidence: [baseDto()],
      scope: { ...scope },
      config: {
        schemaVersion: 1,
        promptVersion: "synthetic",
        provider: "synthetic",
        model: "synthetic",
      },
      deadlineAtMs: 2000,
    })
    expectReject(result, "schema_mismatch")
  })
})

describe("checkPriorQuoteRetention", () => {
  const opts = { nowMs: () => 1000, deadlineAtMs: 2000 }

  test("accepts unchanged witnesses and extra unverified quote", () => {
    const prior = basePayload()
    const candidate = basePayload()
    candidate.facts.push({
      attribution: "contact",
      quotes: [
        {
          ref: { id: "11", createdAtMicros: stamp },
          text: "Extra synthetic quote",
        },
      ],
    })
    expect(
      checkPriorQuoteRetention(
        { priorPayload: prior, candidatePayload: candidate },
        opts,
      ).kind,
    ).toBe("ok")
  })

  test("rejects lost previous witness", () => {
    const prior = basePayload()
    const candidate = basePayload()
    candidate.facts = []
    expectReject(
      checkPriorQuoteRetention(
        { priorPayload: prior, candidatePayload: candidate },
        opts,
      ),
      "prior_retention_violation",
    )
  })

  test("permits regrouping without witness loss", () => {
    const prior = basePayload()
    const candidate = basePayload()
    const extra = {
      ref: { id: "11", createdAtMicros: stamp },
      text: "Extra synthetic quote",
    }
    prior.facts.push({ attribution: "contact", quotes: [extra] })
    candidate.facts[0].quotes.push(structuredClone(extra))
    expect(
      checkPriorQuoteRetention(
        { priorPayload: prior, candidatePayload: candidate },
        opts,
      ).kind,
    ).toBe("ok")
  })

  test("rejects changed previous quote text", () => {
    const prior = basePayload()
    const candidate = basePayload()
    candidate.facts[0].quotes[0].text = "Changed quote"
    expectReject(
      checkPriorQuoteRetention(
        { priorPayload: prior, candidatePayload: candidate },
        opts,
      ),
      "prior_retention_violation",
    )
  })

  test("rejects changed attribution in witness identity", () => {
    const prior = basePayload()
    const candidate = basePayload()
    candidate.facts[0].attribution = "staff"
    expectReject(
      checkPriorQuoteRetention(
        { priorPayload: prior, candidatePayload: candidate },
        opts,
      ),
      "prior_retention_violation",
    )
  })

  test("null prior does not bypass candidate schema", () => {
    expectReject(
      checkPriorQuoteRetention(
        { priorPayload: null, candidatePayload: 42 },
        opts,
      ),
      "schema_mismatch",
    )
  })

  test("honors abort signal", () => {
    const controller = new AbortController()
    controller.abort()
    expectReject(
      checkPriorQuoteRetention(
        { priorPayload: basePayload(), candidatePayload: basePayload() },
        { ...opts, signal: controller.signal },
      ),
      "cancelled",
    )
  })
})

describe("T07-A edge regressions", () => {
  const opts = { nowMs: () => 1000, deadlineAtMs: 2000 }
  const attOf = (m: DialogMemoryMessageDto) => ({
    id: "31",
    createdAtMicros: stamp,
    updatedAtMicros: stamp,
    workspaceId: m.workspaceId,
    conversationId: m.conversationId,
    messageId: m.id,
    messageCreatedAtMicros: m.createdAtMicros,
    fileType: "image",
    sourceId: null,
    mimeType: "image/png",
    width: null,
    height: null,
    size: 1,
    thumbnailPath: null,
    originPath: "synthetic-local",
    name: null,
  })
  const prep = (m: DialogMemoryMessageDto) =>
    prepareMemorySources(
      { sourceEvidence: [m], scope: { ...scope }, deadlineAtMs: 2000 },
      opts,
    )

  test("requires facts instead of defaulting to empty", () => {
    const payload = basePayload()
    Reflect.deleteProperty(payload, "facts")
    expectReject(parseMemoryPayload(payload, opts), "schema_mismatch")
  })

  test("enforces smaller facts cap without mutating options", () => {
    const payload = basePayload()
    payload.facts.push(structuredClone(payload.facts[0]))
    const result = parseMemoryPayload(payload, {
      ...opts,
      limits: { maxFacts: 1 },
    })
    expectReject(result, "schema_mismatch")
  })

  test("object candidate exceeding byte cap is rejected", () => {
    const m = baseDto()
    m.text = "x".repeat(1000)
    const payload = basePayload(m)
    payload.facts = Array.from({ length: VALIDATION_LIMITS.maxFacts }, () => ({
      attribution: "contact" as const,
      quotes: Array.from(
        { length: VALIDATION_LIMITS.maxQuotesPerFact },
        () => ({
          ref: { id: m.id, createdAtMicros: stamp },
          text: m.text ?? "",
        }),
      ),
    }))
    expectReject(parseMemoryPayload(payload, opts), "oversize")
  })

  test("node cap counts primitive leaves", () => {
    const result = parseMemoryPayload(
      { items: new Array(20).fill(0) },
      { ...opts, limits: { maxNodesTotal: 5 } },
    )
    expectReject(result, "not_plain_json")
  })

  test("rejects non-index numeric-looking array property", () => {
    const payload = basePayload()
    Object.defineProperty(payload.facts, "01", {
      enumerable: true,
      value: 7,
    })
    expectReject(parseMemoryPayload(payload, opts), "not_plain_json")
  })

  test("observes deadline during recursive preflight", () => {
    let t = 1000
    const result = parseMemoryPayload(basePayload(), {
      deadlineAtMs: 1003,
      nowMs: () => ++t,
    })
    expectReject(result, "deadline")
  })

  test("does not execute toJSON in source text object", () => {
    let calls = 0
    const m = baseDto()
    ;(m as { text: unknown }).text = {
      toJSON() {
        calls++
        return "FORGED_TEXT"
      },
    }
    const result = prep(m)
    expect(calls).toBe(0)
    expectReject(result, "not_plain_json")
  })

  test("rejects wrong source scalar type structurally", () => {
    const m = baseDto()
    ;(m as { text: unknown }).text = 42
    expectReject(prep(m), "not_plain_json")
  })

  test("does not execute toJSON in attachment name object", () => {
    let calls = 0
    const m = baseDto()
    m.attachments = [attOf(m)]
    ;(m.attachments[0] as { name: unknown }).name = {
      toJSON() {
        calls++
        return "FORGED_NAME"
      },
    }
    const result = prep(m)
    expect(calls).toBe(0)
    expectReject(result, "not_plain_json")
  })

  test("rejects numeric attachment identifier structurally", () => {
    const m = baseDto()
    m.attachments = [attOf(m)]
    ;(m.attachments[0] as { id: unknown }).id = 42
    expectReject(prep(m), "not_plain_json")
  })

  test("rejects attachment array proxy before any trap", () => {
    let calls = 0
    const trap = () => {
      calls++
      throw new Error("ATTACHMENT_ARRAY_PROXY")
    }
    const m = baseDto()
    m.attachments = new Proxy([attOf(m)], {
      get: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
      getOwnPropertyDescriptor: trap,
    })
    const result = prep(m)
    expectReject(result, "not_plain_json")
    expect(calls).toBe(0)
  })

  test("revoked attachment array proxy rejects without throw", () => {
    const m = baseDto()
    const revocable = Proxy.revocable([attOf(m)], {})
    revocable.revoke()
    m.attachments = revocable.proxy
    expectReject(prep(m), "not_plain_json")
  })

  test("observes deadline during attachment loops", () => {
    let t = 1000
    const m = baseDto()
    m.attachments = Array.from({ length: 3 }, (_, i) => ({
      ...attOf(m),
      id: String(31 + i),
    }))
    const result = prepareMemorySources(
      { sourceEvidence: [m], scope: { ...scope }, deadlineAtMs: 1005 },
      { nowMs: () => ++t },
    )
    expectReject(result, "deadline")
  })

  test("ignored metadata toJSON control is not walked or executed", () => {
    let calls = 0
    const m = baseDto()
    ;(m as { contentAttributes: unknown }).contentAttributes = {
      toJSON() {
        calls++
        throw new Error("OPAQUE_META")
      },
    }
    const result = prep(m)
    expect(result.kind).toBe("ok")
    expect(calls).toBe(0)
  })

  test("rejects unknown limit override key", () => {
    expect(() =>
      createDialogMemoryValidator({
        limits: { unknownLimit: 1 } as unknown as Record<string, never>,
        nowMs: () => 1000,
      }),
    ).toThrow(RangeError)
  })
})

describe("T07-A JSON-encoded candidate byte budget", () => {
  const opts = { nowMs: () => 1000, deadlineAtMs: 2000 }

  test("exact canonical object byte boundary is accepted", () => {
    const payload = basePayload()
    const budget = Buffer.byteLength(JSON.stringify(payload))
    const result = parseMemoryPayload(payload, {
      ...opts,
      limits: { maxCandidateUtf8Bytes: budget },
    })
    expect(result.kind).toBe("ok")
  })

  test("one byte below canonical object bound rejects", () => {
    const payload = basePayload()
    const budget = Buffer.byteLength(JSON.stringify(payload))
    const result = parseMemoryPayload(payload, {
      ...opts,
      limits: { maxCandidateUtf8Bytes: budget - 1 },
    })
    expectReject(result, "oversize")
  })

  test("escaped newlines count as JSON bytes for object input", () => {
    const m = baseDto()
    m.text = "a\n".repeat(150)
    const payload = basePayload(m)
    payload.facts = Array.from({ length: 64 }, () => ({
      attribution: "contact" as const,
      quotes: Array.from({ length: 2 }, () => ({
        ref: { id: m.id, createdAtMicros: m.createdAtMicros },
        text: m.text ?? "",
      })),
    }))
    const encodedBytes = Buffer.byteLength(JSON.stringify(payload))
    expect(encodedBytes).toBeGreaterThan(64 * 1024)
    expectReject(parseMemoryPayload(payload, opts), "oversize")
  })

  test("JSON string at exact byte boundary is accepted", () => {
    const candidate = JSON.stringify(basePayload())
    const budget = Buffer.byteLength(candidate)
    const result = parseMemoryPayload(candidate, {
      ...opts,
      limits: { maxCandidateUtf8Bytes: budget },
    })
    expect(result.kind).toBe("ok")
  })
})

describe("T07-A stage order precedence", () => {
  const q = (m: DialogMemoryMessageDto) => ({
    ref: { id: m.id, createdAtMicros: m.createdAtMicros },
    text: m.text ?? "",
  })

  const quotesPayload = (
    attribution: AttributionKind,
    entries: Array<{
      ref: { id: string; createdAtMicros: string }
      text: string
    }>,
  ) => ({
    version: 1 as const,
    facts: [{ attribution, quotes: entries }],
    narrative: { text: "", nonAuthoritative: true as const },
    openQuestions: [],
  })

  const runStage = async (
    payload: unknown,
    sources: DialogMemoryMessageDto[],
  ) =>
    makeValidator().validate({
      candidatePayload: payload,
      sourceEvidence: sources,
      scope: { ...scope },
      config: {
        schemaVersion: 1,
        promptVersion: "synthetic",
        provider: "synthetic",
        model: "synthetic",
      },
      deadlineAtMs: 2000,
    })

  const foreignAttachment = (m: DialogMemoryMessageDto) => ({
    id: "31",
    createdAtMicros: stamp,
    updatedAtMicros: stamp,
    workspaceId: "9",
    conversationId: m.conversationId,
    messageId: m.id,
    messageCreatedAtMicros: m.createdAtMicros,
    fileType: "image",
    sourceId: null,
    mimeType: "image/png",
    width: null,
    height: null,
    size: 1,
    thumbnailPath: null,
    originPath: "synthetic-local",
    name: null,
  })

  test("missing later ref wins over earlier forged role", async () => {
    const a = baseDto()
    const b = baseDto()
    b.id = "2"
    expectReject(
      await runStage(quotesPayload("staff", [q(a), q(b)]), [a]),
      "ref_not_found",
    )
  })

  test("missing later ref wins over earlier quote mismatch", async () => {
    const a = baseDto()
    const b = baseDto()
    b.id = "2"
    const bad = q(a)
    bad.text = "Not in source"
    expectReject(
      await runStage(quotesPayload("contact", [bad, q(b)]), [a]),
      "ref_not_found",
    )
  })

  test("later role failure wins over earlier quote mismatch", async () => {
    const a = baseDto()
    const b = baseDto()
    b.id = "2"
    b.senderType = "user"
    const bad = q(a)
    bad.text = "Not in source"
    expectReject(
      await runStage(quotesPayload("contact", [bad, q(b)]), [a, b]),
      "role_forged",
    )
  })

  test("missing candidate ref wins over foreign source scope", async () => {
    const a = baseDto()
    const b = baseDto()
    a.workspaceId = "9"
    b.id = "2"
    expectReject(
      await runStage(quotesPayload("contact", [q(b)]), [a]),
      "ref_not_found",
    )
  })

  test("late evidence duplicate wins over early foreign scope", () => {
    const a = baseDto()
    const b = baseDto()
    a.workspaceId = "9"
    const result = prepareMemorySources(
      { sourceEvidence: [a, b], scope: { ...scope }, deadlineAtMs: 2000 },
      { nowMs: () => 1000 },
    )
    expectReject(result, "ref_ambiguous")
  })

  test("missing candidate ref wins over foreign attachment parent", async () => {
    const a = baseDto()
    const b = baseDto()
    b.id = "2"
    const attachment = foreignAttachment(
      a,
    ) as unknown as DialogMemoryMessageDto["attachments"][number]
    a.attachments = [attachment]
    expectReject(
      await runStage(quotesPayload("contact", [q(b)]), [a]),
      "ref_not_found",
    )
  })

  test("all-scope guard still rejects unrelated foreign source", async () => {
    const a = baseDto()
    const b = baseDto()
    b.id = "2"
    b.workspaceId = "9"
    expectReject(await runStage(basePayload(a), [a, b]), "scope_mismatch")
  })

  test("valid input control remains accepted", async () => {
    const result = await runStage(basePayload(), [baseDto()])
    expect(result.kind).toBe("accept")
  })
})
