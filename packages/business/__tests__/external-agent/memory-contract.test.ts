import { describe, expect, test } from "vitest"
import {
  attributionKindSchema,
  MEMORY_PAYLOAD_VERSION,
  memoryPayloadSchema,
  sourceRefSchema,
  VALIDATION_FAIL_CODES,
  VALIDATION_LIMITS,
  VALIDATOR_VERSION,
} from "../../src/external-agent/memory-contract"

const makeRef = (overrides?: { id?: string; createdAtMicros?: string }) => ({
  id: overrides?.id ?? "9007199254740993",
  createdAtMicros: overrides?.createdAtMicros ?? "2026-01-02T03:04:05.123456Z",
})

const makeQuote = (overrides?: {
  text?: string
  ref?: ReturnType<typeof makeRef>
}) => ({
  ref: overrides?.ref ?? makeRef(),
  text: overrides?.text ?? "Клиент сообщил о переводе 125.00 RUB.",
})

const makeFact = (overrides?: {
  attribution?: "contact" | "staff" | "automation" | "unknown"
  quotes?: ReturnType<typeof makeQuote>[]
}) => ({
  attribution: overrides?.attribution ?? "contact",
  quotes: overrides?.quotes ?? [makeQuote()],
})

const makePayload = (overrides?: {
  facts?: ReturnType<typeof makeFact>[]
  narrative?: { text: string; nonAuthoritative: true }
  openQuestions?: { text: string; nonAuthoritative: true }[]
}) => ({
  version: 1 as const,
  facts: overrides?.facts ?? [makeFact()],
  narrative: overrides?.narrative ?? {
    text: "Это пересказ, а не подтверждение банка.",
    nonAuthoritative: true as const,
  },
  openQuestions: overrides?.openQuestions ?? [],
})

describe("memory contract constants", () => {
  test("payload version is 1", () => {
    expect(MEMORY_PAYLOAD_VERSION).toBe(1)
  })

  test("validator version is non-empty string", () => {
    expect(typeof VALIDATOR_VERSION).toBe("string")
    expect(VALIDATOR_VERSION.length).toBeGreaterThan(0)
  })

  test("validation limits are positive integers", () => {
    for (const [key, value] of Object.entries(VALIDATION_LIMITS)) {
      expect(Number.isInteger(value), key).toBe(true)
      expect(value, key).toBeGreaterThan(0)
    }
  })

  test("validation fail codes map keys to themselves", () => {
    for (const [key, value] of Object.entries(VALIDATION_FAIL_CODES)) {
      expect(value).toBe(key)
    }
  })
})

describe("sourceRefSchema", () => {
  test("accepts largest canonical PG bigint string", () => {
    const ref = makeRef({ id: "9223372036854775807" })
    expect(sourceRefSchema.safeParse(ref).success).toBe(true)
  })

  test("rejects id above PG bigint bound", () => {
    const ref = makeRef({ id: "9223372036854775808" })
    expect(sourceRefSchema.safeParse(ref).success).toBe(false)
  })

  test("rejects numeric id", () => {
    const ref = { id: 42, createdAtMicros: makeRef().createdAtMicros }
    expect(sourceRefSchema.safeParse(ref).success).toBe(false)
  })

  test("rejects nonexistent calendar date", () => {
    const ref = makeRef({ createdAtMicros: "2026-02-30T00:00:00.000000Z" })
    expect(sourceRefSchema.safeParse(ref).success).toBe(false)
  })
})

describe("memoryPayloadSchema", () => {
  test("accepts a complete valid payload", () => {
    const result = memoryPayloadSchema.safeParse(makePayload())
    expect(result.success).toBe(true)
  })

  test("applies narrative and openQuestion defaults", () => {
    const payload = makePayload()
    Reflect.deleteProperty(payload, "narrative")
    Reflect.deleteProperty(payload, "openQuestions")
    const result = memoryPayloadSchema.parse(payload)
    expect(result.narrative).toEqual({ text: "", nonAuthoritative: true })
    expect(result.openQuestions).toEqual([])
  })

  test("requires the facts field", () => {
    const payload = makePayload()
    Reflect.deleteProperty(payload, "facts")
    expect(memoryPayloadSchema.safeParse(payload).success).toBe(false)
  })

  test("accepts an explicit empty facts array", () => {
    expect(
      memoryPayloadSchema.safeParse(makePayload({ facts: [] })).success,
    ).toBe(true)
  })

  test("rejects unknown extra keys", () => {
    const payload = { ...makePayload(), extra: true }
    expect(memoryPayloadSchema.safeParse(payload).success).toBe(false)
  })

  test("rejects nonAuthoritative false", () => {
    const payload = makePayload({
      narrative: { text: "", nonAuthoritative: false as unknown as true },
    })
    expect(memoryPayloadSchema.safeParse(payload).success).toBe(false)
  })

  test("rejects more than maxFacts", () => {
    const payload = makePayload({
      facts: Array.from({ length: VALIDATION_LIMITS.maxFacts + 1 }, makeFact),
    })
    expect(memoryPayloadSchema.safeParse(payload).success).toBe(false)
  })

  test("rejects more than maxQuotesPerFact", () => {
    const payload = makePayload({
      facts: [
        makeFact({
          quotes: Array.from(
            { length: VALIDATION_LIMITS.maxQuotesPerFact + 1 },
            makeQuote,
          ),
        }),
      ],
    })
    expect(memoryPayloadSchema.safeParse(payload).success).toBe(false)
  })

  test("rejects oversized quote text", () => {
    const payload = makePayload({
      facts: [
        makeFact({
          quotes: [
            makeQuote({
              text: "x".repeat(VALIDATION_LIMITS.maxQuoteUtf16Chars + 1),
            }),
          ],
        }),
      ],
    })
    expect(memoryPayloadSchema.safeParse(payload).success).toBe(false)
  })

  test("rejects oversized narrative", () => {
    const payload = makePayload({
      narrative: {
        text: "x".repeat(VALIDATION_LIMITS.maxNarrativeUtf16Chars + 1),
        nonAuthoritative: true,
      },
    })
    expect(memoryPayloadSchema.safeParse(payload).success).toBe(false)
  })

  test("rejects too many open questions", () => {
    const payload = makePayload({
      openQuestions: Array.from(
        { length: VALIDATION_LIMITS.maxOpenQuestions + 1 },
        (_, i) => ({
          text: `q${i}`,
          nonAuthoritative: true as const,
        }),
      ),
    })
    expect(memoryPayloadSchema.safeParse(payload).success).toBe(false)
  })

  test("rejects oversized open question", () => {
    const payload = makePayload({
      openQuestions: [
        {
          text: "x".repeat(VALIDATION_LIMITS.maxOpenQuestionUtf16Chars + 1),
          nonAuthoritative: true as const,
        },
      ],
    })
    expect(memoryPayloadSchema.safeParse(payload).success).toBe(false)
  })

  test("rejects free fact prose", () => {
    const payload = makePayload({
      facts: [
        {
          ...makeFact(),
          text: "Банк подтвердил оплату",
        } as unknown as ReturnType<typeof makeFact>,
      ],
    })
    expect(memoryPayloadSchema.safeParse(payload).success).toBe(false)
  })
})

describe("attribution kind schema", () => {
  test.each([
    "contact",
    "staff",
    "automation",
    "unknown",
  ] as const)("accepts %s", (kind) => {
    expect(attributionKindSchema.safeParse(kind).success).toBe(true)
  })

  test("rejects assistant", () => {
    expect(attributionKindSchema.safeParse("assistant").success).toBe(false)
  })
})
