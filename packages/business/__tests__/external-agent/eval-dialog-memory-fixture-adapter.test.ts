import { describe, expect, test } from "vitest"
import type { MemoryValidationOptions } from "../../../../packages/business/src/external-agent/memory-contract"
import { buildSummarizeRequest } from "../../../../packages/business/src/external-agent/memory-prompt"
import {
  ADAPTER_VERSION,
  adaptDialogMemoryCase,
  MAX_CASE_JSON_UTF8_BYTES,
  normalizeFixtureTime,
} from "../../../../scripts/lib/eval-dialog-memory-fixture-adapter"

const scope = {
  workspaceId: "1",
  conversationId: "2",
  expectedContactId: "4",
}

const options: MemoryValidationOptions = { nowMs: () => 1000 }

const CANONICAL_POSITIVE_BIGINT_RE = /^[1-9]\d*$/

const SYNTHETIC_MESSAGE_KEY = "synthetic-adapter-"

type FixtureMessage = {
  id: string
  createdAt: string
  role: "contact" | "manager" | "platform" | "assistant"
  channel: string
  text: string
  orderId: string | null
  deleted?: boolean
  deletedAt?: string | null
}

type FixtureEvidence = {
  messageId: string
  quote: string
  kind:
    | "client_claim"
    | "manager_statement"
    | "platform_notice"
    | "assistant_statement"
  orderId: string | null
}

type Fixture = {
  id: string
  split: "development" | "holdout"
  scenario: string
  messages: FixtureMessage[]
  currentMessageIds: string[]
  requiredEvidence: FixtureEvidence[]
  openQuestions: string[]
  forbiddenClaims: string[]
  expectedBehavior: string
  mutation?: unknown
}

type AdaptInput = Parameters<typeof adaptDialogMemoryCase>[0]

const noChange = (_fixture: Fixture): void => {
  /* intentional no mutation */
}

const baseFixture = (): Fixture => ({
  id: "t06-c01",
  split: "development",
  scenario: "SYNTHETIC_SCENARIO",
  messages: [
    {
      id: "m-unit-2",
      createdAt: "2026-01-03T03:04:05Z",
      role: "contact",
      channel: "zzap",
      text: "Новый вопрос.",
      orderId: null,
    },
    {
      id: "m-unit-1",
      createdAt: "2026-01-02T03:04:05.123456Z",
      role: "contact",
      channel: "email",
      text: "Не оплачено. Сумма 125.00 RUB; HNQ4051GQ",
      orderId: "SYNTHETIC_ORDER",
    },
  ],
  currentMessageIds: ["m-unit-2"],
  requiredEvidence: [
    {
      messageId: "m-unit-1",
      quote: "Не оплачено.",
      kind: "client_claim",
      orderId: "SYNTHETIC_ORDER",
    },
  ],
  openQuestions: ["SYNTHETIC_QUESTION"],
  forbiddenClaims: ["SYNTHETIC_FORBIDDEN"],
  expectedBehavior: "SYNTHETIC_EXPECTED",
})

const buildFixture = (patch: (f: Fixture) => void = noChange) => {
  const f = JSON.parse(JSON.stringify(baseFixture())) as Fixture
  patch(f)
  return f
}

const adapt = (
  patch: (f: Fixture) => void = noChange,
  more: Partial<AdaptInput> = {},
  opts = options,
) =>
  adaptDialogMemoryCase(
    {
      caseJson: JSON.stringify(buildFixture(patch)),
      scope: { ...scope },
      deadlineAtMs: 2000,
      ...more,
    },
    opts,
  )

const expectReject = (
  result: { kind: string; reason?: string },
  code: string,
) => {
  expect(result.kind).toBe("reject")
  expect(result.reason).toBe(code)
}

describe("adapter API", () => {
  test("exports version and byte bound", () => {
    expect(ADAPTER_VERSION).toBe("t08-fixture-v1")
    expect(MAX_CASE_JSON_UTF8_BYTES).toBe(2_097_152)
  })

  test("binding functions are callable runtime values", () => {
    expect(typeof normalizeFixtureTime).toBe("function")
    expect(typeof adaptDialogMemoryCase).toBe("function")
  })
})

describe("normalizeFixtureTime", () => {
  test("accepts exact six-digit UTC and leaves it", () => {
    expect(normalizeFixtureTime("2026-01-02T03:04:05.123456Z")).toEqual({
      kind: "ok",
      value: "2026-01-02T03:04:05.123456Z",
    })
  })

  test("pads short fractional seconds to microseconds", () => {
    expect(normalizeFixtureTime("2026-01-02T03:04:05.123Z")).toEqual({
      kind: "ok",
      value: "2026-01-02T03:04:05.123000Z",
    })
    expect(normalizeFixtureTime("2026-01-02T03:04:05Z")).toEqual({
      kind: "ok",
      value: "2026-01-02T03:04:05.000000Z",
    })
  })

  test("rejects calendar-invalid date", () => {
    expectReject(normalizeFixtureTime("2026-02-31T03:04:05Z"), "invalid_time")
  })

  test("rejects sub-microsecond precision without rounding", () => {
    expectReject(
      normalizeFixtureTime("2026-01-02T03:04:05.1234567Z"),
      "time_precision_loss",
    )
  })

  test("rejects well-formed UTC with a long fractional tail", () => {
    expectReject(
      normalizeFixtureTime("2026-01-02T03:04:05.1234567890123456789Z"),
      "time_precision_loss",
    )
  })

  test("rejects timezone offsets", () => {
    expectReject(
      normalizeFixtureTime("2026-01-02T03:04:05+03:00"),
      "invalid_time",
    )
  })

  test("rejects non-string input", () => {
    expectReject(normalizeFixtureTime(42), "invalid_time")
  })
})

describe("adaptDialogMemoryCase", () => {
  test("retains all history beyond current delivery window", () => {
    const result = adapt()
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.source.eligibleHistory.length).toBe(2)
      expect(result.source.evidenceSnapshot.length).toBe(2)
      expect(result.grading.currentWindowRefs.length).toBe(1)
      expect(result.source.eligibleHistory[0].text).toBe(
        baseFixture().messages[1].text,
      )
    }
  })

  test("empty delivery window still retains full source", () => {
    const result = adapt((f) => {
      f.currentMessageIds = []
    })
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.source.eligibleHistory.length).toBe(2)
    }
  })

  test("actual T07 packet contains old fact outside current window", () => {
    const result = adapt()
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }

    const request = buildSummarizeRequest(
      {
        mode: "rebuild",
        batch: result.source.eligibleHistory,
        evidence: result.source.evidenceSnapshot,
        priorPayload: null,
        scope: result.source.scope,
        deadlineAtMs: 2000,
        budget: { maxEncodedChars: 24_000 },
      } as unknown as Parameters<typeof buildSummarizeRequest>[0],
      options,
    )
    expect(request.kind).toBe("ok")
    if (request.kind !== "ok") {
      return
    }

    const data = JSON.parse(request.messages[1].content)
    expect(
      data.sourceMessages.some((m: { text: string | null }) =>
        m.text?.includes("Не оплачено."),
      ),
    ).toBe(true)
    expect(data.newBatchRefs.length).toBe(2)
  })

  test("grading metadata never appears in candidate source DTO", () => {
    const result = adapt()
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }

    expect(Object.keys(result.source).sort()).toEqual([
      "eligibleHistory",
      "evidenceSnapshot",
      "scope",
    ])

    const serialized = JSON.stringify(result.source)
    for (const sentinel of [
      "SYNTHETIC_SCENARIO",
      "SYNTHETIC_ORDER",
      "SYNTHETIC_QUESTION",
      "SYNTHETIC_FORBIDDEN",
      "SYNTHETIC_EXPECTED",
      "requiredEvidence",
      "expectedBehavior",
    ]) {
      expect(serialized).not.toContain(sentinel)
    }

    expect(result.grading.caseId).toBe("t06-c01")
    expect(result.grading.requiredEvidence[0].quote).toBe("Не оплачено.")
  })

  test("opaque fixture IDs are bijective and deterministic", () => {
    const first = adapt()
    expect(first.kind).toBe("ok")
    if (first.kind !== "ok") {
      return
    }

    const second = adapt((f) => {
      f.messages = [...f.messages].reverse()
    })
    expect(second.kind).toBe("ok")
    if (second.kind !== "ok") {
      return
    }

    for (const message of baseFixture().messages) {
      const id = first.grading.fixtureToDtoId.get(message.id)
      expect(id).toMatch(CANONICAL_POSITIVE_BIGINT_RE)
      if (id === undefined) {
        throw new Error("missing dto id for fixture message")
      }
      expect(first.grading.dtoToFixtureId.get(id)).toBe(message.id)
      expect(second.grading.fixtureToDtoId.get(message.id)).toBe(id)
    }
  })

  test("distinct numeric-looking opaque IDs are not repaired", () => {
    const result = adapt((f) => {
      f.messages[0].id = "01"
      f.messages[1].id = "1"
      f.currentMessageIds = ["01"]
      f.requiredEvidence[0].messageId = "1"
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }

    expect(result.grading.fixtureToDtoId.get("01")).not.toBe(
      result.grading.fixtureToDtoId.get("1"),
    )
  })

  test("__proto__ fixture key is safe in identity maps", () => {
    const result = adapt((f) => {
      f.messages[0].id = "__proto__"
      f.currentMessageIds = ["__proto__"]
      f.requiredEvidence = []
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }

    const id = result.grading.fixtureToDtoId.get("__proto__")
    expect(id).toBeDefined()
    if (id === undefined) {
      throw new Error("missing dto id for prototype-like fixture key")
    }
    expect(result.grading.dtoToFixtureId.get(id)).toBe("__proto__")
  })

  test("rejects duplicate fixture IDs", () => {
    expectReject(
      adapt((f) => {
        f.messages[1].id = f.messages[0].id
      }),
      "duplicate_fixture_id",
    )
  })

  test("maps roles and channels independently", () => {
    const result = adapt((f) => {
      f.messages = (
        ["contact", "manager", "platform", "assistant"] as const
      ).map((role, i) => ({
        id: `synthetic-${i}`,
        createdAt: "2026-01-02T03:04:05Z",
        role,
        channel: "activity",
        text: role,
        orderId: null,
      }))
      f.currentMessageIds = []
      f.requiredEvidence = []
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }

    const byText = new Map(
      result.source.evidenceSnapshot.map((m) => [m.text, m]),
    )

    for (const [role, senderType, messageType] of [
      ["contact", "contact", "incoming"],
      ["manager", "user", "outgoing"],
      ["platform", "api", "outgoing"],
      ["assistant", "bot", "outgoing"],
    ] as const) {
      const dto = byText.get(role)
      expect(dto).toBeDefined()
      if (dto === undefined) {
        throw new Error(`missing mapped dto for role ${role}`)
      }
      expect(dto.senderType).toBe(senderType)
      expect(dto.type).toBe("message")
      expect(dto.contentType).toBe("text")
      expect(dto.messageType).toBe(messageType)
    }
  })

  test("deleted source is retained as tombstone but not eligible", () => {
    const result = adapt((f) => {
      f.messages[1].deleted = true
      f.messages[1].deletedAt = "2026-01-04T03:04:05Z"
      f.requiredEvidence = []
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }

    expect(result.source.evidenceSnapshot.length).toBe(2)
    expect(result.source.eligibleHistory.length).toBe(1)
    expect(result.source.evidenceSnapshot[0].deletedAtMicros).toBe(
      "2026-01-04T03:04:05.000000Z",
    )
  })

  test("deleted=true without timestamp rejects", () => {
    expectReject(
      adapt((f) => {
        f.messages[1].deleted = true
      }),
      "fixture_schema_mismatch",
    )
  })

  test("deleted=false with timestamp rejects", () => {
    expectReject(
      adapt((f) => {
        f.messages[1].deleted = false
        f.messages[1].deletedAt = "2026-01-04T03:04:05Z"
      }),
      "fixture_schema_mismatch",
    )
  })

  test("current window with unknown reference rejects", () => {
    expectReject(
      adapt((f) => {
        f.currentMessageIds = ["missing"]
      }),
      "invalid_current_window",
    )
  })

  test("current window with deleted reference rejects", () => {
    expectReject(
      adapt((f) => {
        f.messages[1].deleted = true
        f.messages[1].deletedAt = "2026-01-04T03:04:05Z"
      }),
      "invalid_current_window",
    )
  })

  test("duplicate current window reference rejects", () => {
    expectReject(
      adapt((f) => {
        f.currentMessageIds = ["m-unit-2", "m-unit-2"]
      }),
      "invalid_current_window",
    )
  })

  test("required witness with missing reference rejects", () => {
    expectReject(
      adapt((f) => {
        f.requiredEvidence[0].messageId = "missing"
      }),
      "invalid_expected_evidence",
    )
  })

  test("required witness with deleted reference rejects", () => {
    expectReject(
      adapt((f) => {
        f.messages[1].deleted = true
        f.messages[1].deletedAt = "2026-01-04T03:04:05Z"
      }),
      "invalid_expected_evidence",
    )
  })

  test("required quote not literal rejects", () => {
    expectReject(
      adapt((f) => {
        f.requiredEvidence[0].quote = "Оплачено полностью"
      }),
      "invalid_expected_evidence",
    )
  })

  test("mutation.previousMemory is never treated as evidence", () => {
    const result = adapt((f) => {
      f.mutation = { previousMemory: { text: "FAKE_OLD_HISTORY" } }
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }

    expect(result.source.eligibleHistory.length).toBe(2)
    expect(JSON.stringify(result.source)).not.toContain("FAKE_OLD_HISTORY")
  })

  test("preserves literal text including amounts, rubric words and URLs", () => {
    const result = adapt((f) => {
      f.messages[0].text =
        "125.00 RUB HNQ4051GQ HNQ4O51GQ requiredEvidence https://example.invalid/"
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") {
      return
    }

    expect(
      result.source.evidenceSnapshot.some(
        (m) =>
          m.text ===
          "125.00 RUB HNQ4051GQ HNQ4O51GQ requiredEvidence https://example.invalid/",
      ),
    ).toBe(true)
  })

  test("invalid JSON rejects", () => {
    expectReject(adapt(noChange, { caseJson: "{bad" }), "invalid_case_json")
  })

  test("non-string input does not trigger toJSON coercion", () => {
    let calls = 0
    const badInput = {
      toJSON: () => {
        calls++
        throw new Error("TOJSON")
      },
    }
    const result = adaptDialogMemoryCase(
      {
        caseJson: badInput as unknown as string,
        scope: { ...scope },
        deadlineAtMs: 2000,
      },
      options,
    )
    expectReject(result, "invalid_case_json")
    expect(calls).toBe(0)
  })

  test("case byte bound is enforced before JSON.parse", () => {
    expectReject(
      adapt(noChange, { caseJson: " ".repeat(2_097_153) }),
      "case_too_large",
    )
  })

  test("source limits lower override is honored via source_rejected", () => {
    expectReject(
      adapt(noChange, {}, { ...options, limits: { maxSourceItems: 1 } }),
      "source_rejected",
    )
  })

  test("deadline is propagated", () => {
    expectReject(adapt(noChange, { deadlineAtMs: 999 }), "deadline")
  })

  test("abort signal is propagated", () => {
    const controller = new AbortController()
    controller.abort()
    expectReject(adapt(noChange, { signal: controller.signal }), "cancelled")
  })

  test("ordinal map stops writing on cancellation per iteration", () => {
    const controller = new AbortController()
    const patchMessages = (f: Fixture): void => {
      const messages: FixtureMessage[] = []
      for (let index = 0; index < 10; index++) {
        messages.push({
          id: `${SYNTHETIC_MESSAGE_KEY}${index}`,
          createdAt: "2026-01-02T03:04:05Z",
          role: "contact",
          channel: "email",
          text: "synthetic",
          orderId: null,
        })
      }
      f.messages = messages
      f.currentMessageIds = []
      f.requiredEvidence = []
    }
    const originalSet = Map.prototype.set
    let writes = 0
    Map.prototype.set = new Proxy(originalSet, {
      apply: (target, thisArg, args) => {
        const result: unknown = Reflect.apply(target, thisArg, args)
        const [key, value] = args
        if (
          typeof key === "string" &&
          key.startsWith(SYNTHETIC_MESSAGE_KEY) &&
          typeof value === "string"
        ) {
          writes++
          if (writes === 3) {
            controller.abort()
          }
        }
        return result
      },
    })
    try {
      const result = adapt(patchMessages, { signal: controller.signal })
      expectReject(result, "cancelled")
      expect(writes).toBeLessThanOrEqual(3)
    } finally {
      Map.prototype.set = originalSet
    }
  })

  test("returned scope is detached from caller", () => {
    const supplied = { ...scope }
    const result = adapt(noChange, { scope: supplied })
    expect(result.kind).toBe("ok")
    supplied.workspaceId = "99"
    if (result.kind === "ok") {
      expect(result.source.scope.workspaceId).toBe("1")
      expect(result.source.evidenceSnapshot[0].workspaceId).toBe("1")
    }
  })

  test("invalid fixture time rejects", () => {
    expectReject(
      adapt((f) => {
        f.messages[0].createdAt = "2026-02-31T03:04:05Z"
      }),
      "invalid_time",
    )
  })

  test("time precision loss rejects", () => {
    expectReject(
      adapt((f) => {
        f.messages[0].createdAt = "2026-01-02T03:04:05.1234567Z"
      }),
      "time_precision_loss",
    )
  })

  test("fixture schema mismatch for unknown message field", () => {
    expectReject(
      adapt((f) => {
        ;(f.messages[0] as { extra?: string }).extra = "forbidden"
      }),
      "fixture_schema_mismatch",
    )
  })

  test("fixture schema mismatch for unknown case field", () => {
    expectReject(
      adapt((f) => {
        ;(f as { extra?: string }).extra = "forbidden"
      }),
      "fixture_schema_mismatch",
    )
  })
})
