import type { DialogMemoryMessageDto } from "@chatbotx.io/database/repositories"
import { describe, expect, test } from "vitest"

import {
  type CaseDisposition,
  EVALUATOR_VERSION,
  type EvalFailCode,
  type EvaluateDialogMemoryCaseInput,
  type EvaluatorOptions,
  evaluateDialogMemoryCase,
  type JudgePort,
  type JudgePortCall,
  type JudgePortResult,
  MAX_RAW_CANDIDATE_UTF8_BYTES,
  MAX_RAW_CANDIDATE_UTF16_CHARS,
  MAX_WITNESSES_PER_CASE,
} from "../../../../scripts/lib/eval-dialog-memory-evaluator"
import type {
  AdaptedSource,
  ExpectedWitness,
  PrivateGradingEnvelope,
} from "../../../../scripts/lib/eval-dialog-memory-fixture-adapter"
import type { MemoryPayload } from "../../src/external-agent/memory-contract"

const scope = {
  workspaceId: "1",
  conversationId: "2",
  expectedContactId: "4",
}

const stamp = "2026-01-02T03:04:05.123456Z"

const baseDto = (
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

const basePayload = (
  m: DialogMemoryMessageDto = baseDto(),
  quote: string = m.text ?? "",
): MemoryPayload => ({
  version: 1,
  facts: [
    {
      attribution: "contact",
      quotes: [
        { ref: { id: m.id, createdAtMicros: m.createdAtMicros }, text: quote },
      ],
    },
  ],
  narrative: {
    text: "Клиент сообщил, что не оплатил.",
    nonAuthoritative: true,
  },
  openQuestions: [],
})

const sourceFrom = (
  items: readonly DialogMemoryMessageDto[],
): AdaptedSource => ({
  scope: { ...scope },
  eligibleHistory: items.filter(
    (m) => m.type === "message" && m.deletedAtMicros === null,
  ),
  evidenceSnapshot: items,
})

const witness = (
  m: DialogMemoryMessageDto = baseDto(),
  quote: string = m.text ?? "",
): ExpectedWitness => ({
  fixtureMessageId: `fixture-${m.id}`,
  ref: { id: m.id, createdAtMicros: m.createdAtMicros },
  quote,
  attribution: "contact",
  kind: "client_claim",
  orderId: null,
})

const grade = (
  items: readonly DialogMemoryMessageDto[] = [baseDto()],
  required: readonly ExpectedWitness[] = [witness()],
): PrivateGradingEnvelope => ({
  caseId: "t06-c01",
  split: "development",
  scenario: "PRIVATE_SCENARIO",
  currentWindowRefs: [],
  fixtureToDtoId: new Map(items.map((m) => [`fixture-${m.id}`, m.id])),
  dtoToFixtureId: new Map(items.map((m) => [m.id, `fixture-${m.id}`])),
  requiredEvidence: required,
  openQuestions: ["PRIVATE_QUESTION"],
  forbiddenClaims: ["PRIVATE_FORBIDDEN"],
  expectedBehavior: "PRIVATE_EXPECTED",
  sourceMetadataByDtoId: new Map(),
})

const judgeDecision = (
  verdict: "pass" | "reject" | "inconclusive" = "pass",
  codes: string[] = ["faithful"],
) => ({
  kind: "ok" as const,
  content: JSON.stringify({ version: 1, verdict, codes }),
})

type RunResult = {
  result: Awaited<ReturnType<typeof evaluateDialogMemoryCase>>
  calls: unknown[]
}

const make = (
  extra: Partial<EvaluateDialogMemoryCaseInput> = {},
): EvaluateDialogMemoryCaseInput =>
  ({
    source: sourceFrom([baseDto()]),
    candidateRaw: JSON.stringify(basePayload()),
    grade: grade(),
    mode: "rebuild",
    priorPayload: null,
    caseDisposition: "eligible",
    deadlineAtMs: 2000,
    ...extra,
  }) as EvaluateDialogMemoryCaseInput

const run = async (
  extra: Partial<EvaluateDialogMemoryCaseInput> = {},
  opts?: EvaluatorOptions,
  double: (
    call: JudgePortCall,
    input: EvaluateDialogMemoryCaseInput,
  ) => Promise<unknown> = () => Promise.resolve(judgeDecision()),
): Promise<RunResult> => {
  const calls: unknown[] = []
  const input = make(extra)
  input.judgePort = (call) => {
    calls.push(call)
    return double(call, input) as Promise<JudgePortResult>
  }
  const result = await evaluateDialogMemoryCase(
    input,
    opts ?? { nowMs: () => 1000 },
  )
  return { result, calls }
}

describe("eval-dialog-memory-evaluator", () => {
  test("exact five runtime exports and constants", async () => {
    const evaluatorModule = await import(
      "../../../../scripts/lib/eval-dialog-memory-evaluator"
    )
    expect(
      Object.keys({
        EVALUATOR_VERSION,
        evaluateDialogMemoryCase,
        MAX_RAW_CANDIDATE_UTF16_CHARS,
        MAX_RAW_CANDIDATE_UTF8_BYTES,
        MAX_WITNESSES_PER_CASE,
      }).sort(),
    ).toEqual(
      [
        "EVALUATOR_VERSION",
        "MAX_RAW_CANDIDATE_UTF16_CHARS",
        "MAX_RAW_CANDIDATE_UTF8_BYTES",
        "MAX_WITNESSES_PER_CASE",
        "evaluateDialogMemoryCase",
      ].sort(),
    )
    expect(Object.keys(evaluatorModule).sort()).toEqual(
      [
        "EVALUATOR_VERSION",
        "MAX_RAW_CANDIDATE_UTF16_CHARS",
        "MAX_RAW_CANDIDATE_UTF8_BYTES",
        "MAX_WITNESSES_PER_CASE",
        "evaluateDialogMemoryCase",
      ].sort(),
    )
    expect(EVALUATOR_VERSION).toBe("t08-evaluator-v1")
    expect(MAX_RAW_CANDIDATE_UTF16_CHARS).toBe(20_000)
    expect(MAX_RAW_CANDIDATE_UTF8_BYTES).toBe(65_536)
    expect(MAX_WITNESSES_PER_CASE).toBe(1024)
  })

  test("judge port types are exported as usable contracts", () => {
    const port: JudgePort = (_call: JudgePortCall) =>
      Promise.resolve<JudgePortResult>(judgeDecision())
    expect(typeof port).toBe("function")
  })

  test("full coverage + PASS double yields pass with one call", async () => {
    const { result, calls } = await run()
    expect(result.outcome).toBe("pass")
    expect(result.codes).toEqual([])
    expect(result.coverage).toEqual({ required: 1, covered: 1 })
    expect(result.judge?.verdict).toBe("pass")
    expect(calls.length).toBe(1)
  })

  test("old outside-window witness missing rejects before judge", async () => {
    const items = [
      baseDto(),
      baseDto({
        id: "11",
        createdAtMicros: "2026-01-03T03:04:05.123456Z",
        updatedAtMicros: "2026-01-03T03:04:05.123456Z",
        text: "Новый вопрос.",
      }),
    ]
    const g = grade(
      items,
      items.map((m) => witness(m)),
    )
    g.currentWindowRefs = [
      { id: items[1].id, createdAtMicros: items[1].createdAtMicros },
    ]
    const { result, calls } = await run({
      source: sourceFrom(items),
      grade: g,
      candidateRaw: JSON.stringify(basePayload(items[1])),
    })
    expect(result.outcome).toBe("reject")
    expect(result.codes).toEqual(["required_evidence_missing"])
    expect(result.coverage).toEqual({ required: 2, covered: 1 })
    expect(result.diagnostics?.witnessIndex).toBe(0)
    expect(calls.length).toBe(0)
  })

  test("short candidate fragment cannot cover longer expected quote", async () => {
    const { result, calls } = await run({
      candidateRaw: JSON.stringify(basePayload(baseDto(), "оплатил")),
    })
    expect(result.outcome).toBe("reject")
    expect(result.codes).toEqual(["required_evidence_missing"])
    expect(calls.length).toBe(0)
  })

  test("candidate quote may be longer than expected whole witness", async () => {
    const m = baseDto()
    const { result, calls } = await run({
      source: sourceFrom([m]),
      grade: grade([m], [witness(m, "Не оплатил.")]),
      candidateRaw: JSON.stringify(basePayload(m)),
    })
    expect(result.outcome).toBe("pass")
    expect(calls.length).toBe(1)
  })

  test("wrong quote reference id is candidate_invalid_output", async () => {
    const p = basePayload()
    p.facts[0].quotes[0].ref.id = "99"
    const { result, calls } = await run({ candidateRaw: JSON.stringify(p) })
    expect(result.outcome).toBe("invalid_output")
    expect(result.codes).toEqual(["candidate_invalid_output"])
    expect(calls.length).toBe(0)
  })

  test("wrong reference microseconds is candidate_invalid_output", async () => {
    const p = basePayload()
    p.facts[0].quotes[0].ref.createdAtMicros = "2026-01-02T03:04:05.123457Z"
    const { result, calls } = await run({ candidateRaw: JSON.stringify(p) })
    expect(result.outcome).toBe("invalid_output")
    expect(result.codes).toEqual(["candidate_invalid_output"])
    expect(calls.length).toBe(0)
  })

  test("forged role is candidate_invalid_output", async () => {
    const p = basePayload()
    p.facts[0].attribution = "staff"
    const { result, calls } = await run({ candidateRaw: JSON.stringify(p) })
    expect(result.outcome).toBe("invalid_output")
    expect(result.codes).toEqual(["candidate_invalid_output"])
    expect(calls.length).toBe(0)
  })

  test("changed amount quote is candidate_invalid_output", async () => {
    const { result, calls } = await run({
      candidateRaw: JSON.stringify(basePayload(baseDto(), "125.01")),
    })
    expect(result.outcome).toBe("invalid_output")
    expect(result.codes).toEqual(["candidate_invalid_output"])
    expect(calls.length).toBe(0)
  })

  test("foreign scope source is infrastructure gate not candidate blame", async () => {
    const items = [baseDto(), baseDto({ id: "12", conversationId: "99" })]
    const { result, calls } = await run({
      source: sourceFrom(items),
      grade: grade(items),
    })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["candidate_source_invalid"])
    expect(calls.length).toBe(0)
  })

  test("lower source limit reports budget block", async () => {
    const items = [
      baseDto(),
      baseDto({
        id: "11",
        createdAtMicros: "2026-01-03T03:04:05.123456Z",
        updatedAtMicros: "2026-01-03T03:04:05.123456Z",
      }),
    ]
    const { result, calls } = await run(
      { source: sourceFrom(items), grade: grade(items) },
      { nowMs: () => 1000, limits: { maxSourceItems: 1 } },
    )
    expect(result.outcome).toBe("budget_blocked")
    expect(result.codes).toEqual(["source_budget_exceeded"])
    expect(calls.length).toBe(0)
  })

  test("legitimate short yes and no permitted with PASS double", async () => {
    for (const text of ["Да", "Нет"]) {
      const m = baseDto({ text })
      const { result, calls } = await run({
        source: sourceFrom([m]),
        grade: grade([m], [witness(m)]),
        candidateRaw: JSON.stringify(basePayload(m)),
      })
      expect(result.outcome).toBe("pass")
      expect(calls.length).toBe(1)
    }
  })

  test("empty required list still obeys independent REJECT double", async () => {
    const { result, calls } = await run(
      { grade: grade([baseDto()], []) },
      { nowMs: () => 1000 },
      () => Promise.resolve(judgeDecision("reject", ["uninformative_summary"])),
    )
    expect(result.outcome).toBe("reject")
    expect(result.codes).toEqual([])
    expect(result.judge?.verdict).toBe("reject")
    expect(calls.length).toBe(1)
  })

  test("all correct quotes with false narrative obeys REJECT double wiring", async () => {
    const p = basePayload()
    p.narrative.text = "Оплата подтверждена банком."
    const { result, calls } = await run(
      { candidateRaw: JSON.stringify(p) },
      { nowMs: () => 1000 },
      () => Promise.resolve(judgeDecision("reject", ["unsupported_claim"])),
    )
    expect(result.outcome).toBe("reject")
    expect(calls.length).toBe(1)
  })

  test("append missing previously accepted quotation rejects before judge", async () => {
    const items = [
      baseDto(),
      baseDto({
        id: "11",
        createdAtMicros: "2026-01-03T03:04:05.123456Z",
        updatedAtMicros: "2026-01-03T03:04:05.123456Z",
        text: "Новый вопрос.",
      }),
    ]
    const { result, calls } = await run({
      source: sourceFrom(items),
      grade: grade(items, [witness(items[1])]),
      candidateRaw: JSON.stringify(basePayload(items[1])),
      mode: "append",
      priorPayload: basePayload(items[0]),
    })
    expect(result.outcome).toBe("reject")
    expect(result.codes).toEqual(["prior_retention_violation"])
    expect(calls.length).toBe(0)
  })

  test("append retained valid prior proceeds to one judge call", async () => {
    const { result, calls } = await run({
      mode: "append",
      priorPayload: basePayload(),
    })
    expect(result.outcome).toBe("pass")
    expect(calls.length).toBe(1)
  })

  test("invalid prior cannot be counted as candidate failure", async () => {
    const { result, calls } = await run({
      mode: "append",
      priorPayload: { version: 999 },
    })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_prior"])
    expect(calls.length).toBe(0)
  })

  test("mode and prior mismatch is gate pending", async () => {
    let r = await run({ mode: "rebuild", priorPayload: basePayload() })
    expect(r.result.outcome).toBe("gate_pending")
    expect(r.result.codes).toEqual(["invalid_mode_config"])
    expect(r.calls.length).toBe(0)

    r = await run({ mode: "append", priorPayload: null })
    expect(r.result.outcome).toBe("gate_pending")
    expect(r.result.codes).toEqual(["invalid_mode_config"])
    expect(r.calls.length).toBe(0)
  })

  test("expected quote exceeding representable length is blocked", async () => {
    const m = baseDto({ text: "x".repeat(1001) })
    const { result, calls } = await run({
      source: sourceFrom([m]),
      grade: grade([m], [witness(m)]),
      candidateRaw: JSON.stringify(basePayload(m, "x")),
    })
    expect(result.outcome).toBe("budget_blocked")
    expect(result.codes).toEqual(["witness_unrepresentable"])
    expect(calls.length).toBe(0)
  })

  test("broken inverse map is invalid grading", async () => {
    const g = grade()
    g.dtoToFixtureId.set(baseDto().id, "wrong-fixture")
    const { result, calls } = await run({ grade: g })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_grading"])
    expect(calls.length).toBe(0)
  })

  test("duplicate canonical id, distinct timestamps and ghost map entry", async () => {
    const a = baseDto({ id: "11", text: "A" })
    const b = baseDto({
      id: "11",
      createdAtMicros: "2026-01-03T03:04:05.123456Z",
      updatedAtMicros: "2026-01-03T03:04:05.123456Z",
      text: "B",
    })
    const lastWitness = witness(b)
    lastWitness.fixtureMessageId = "fixture-last"
    const g = grade([a, b], [lastWitness])
    g.fixtureToDtoId = new Map([
      ["fixture-last", "11"],
      ["fixture-ghost", "12"],
    ])
    g.dtoToFixtureId = new Map([
      ["11", "fixture-last"],
      ["12", "fixture-ghost"],
    ])
    const { result, calls } = await run({
      source: sourceFrom([a, b]),
      grade: g,
      candidateRaw: JSON.stringify(basePayload(b)),
    })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_grading"])
    expect(calls.length).toBe(0)
  })

  test("duplicate ids cannot fake map coverage with empty required evidence", async () => {
    const a = baseDto({ id: "11", text: "A" })
    const b = baseDto({
      id: "11",
      createdAtMicros: "2026-01-03T03:04:05.123456Z",
      updatedAtMicros: "2026-01-03T03:04:05.123456Z",
      text: "B",
    })
    const g = grade([a, b], [])
    g.fixtureToDtoId = new Map([
      ["fixture-last", "11"],
      ["fixture-ghost", "12"],
    ])
    g.dtoToFixtureId = new Map([
      ["11", "fixture-last"],
      ["12", "fixture-ghost"],
    ])
    const { result, calls } = await run({
      source: sourceFrom([a, b]),
      grade: g,
      candidateRaw: JSON.stringify(basePayload(b)),
    })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_grading"])
    expect(calls.length).toBe(0)
  })

  test("all grading validated before blaming earlier missing witness", async () => {
    const items = [
      baseDto(),
      baseDto({
        id: "11",
        createdAtMicros: "2026-01-03T03:04:05.123456Z",
        updatedAtMicros: "2026-01-03T03:04:05.123456Z",
        text: "Новый вопрос.",
      }),
    ]
    const w = items.map((m) => witness(m))
    w[1].quote = "NOT_IN_SOURCE"
    const { result, calls } = await run({
      source: sourceFrom(items),
      grade: grade(items, w),
      candidateRaw: JSON.stringify(basePayload(items[1])),
    })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_grading"])
    expect(calls.length).toBe(0)
  })

  test("empty expected quotation is invalid grading", async () => {
    const m = baseDto()
    const { result, calls } = await run({
      source: sourceFrom([m]),
      grade: grade([m], [witness(m, "")]),
      candidateRaw: JSON.stringify(basePayload(m)),
    })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_grading"])
    expect(calls.length).toBe(0)
  })

  test("unpaired surrogate witness is invalid grading", async () => {
    const m = baseDto({ text: "😀" })
    const { result, calls } = await run({
      source: sourceFrom([m]),
      grade: grade([m], [witness(m, "\ud83d")]),
      candidateRaw: JSON.stringify(basePayload(m)),
    })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_grading"])
    expect(calls.length).toBe(0)
  })

  test("empty fixture identifiers in mutually inverse maps are invalid", async () => {
    const m = baseDto()
    const w = witness(m)
    w.fixtureMessageId = ""
    const g = grade([m], [w])
    g.fixtureToDtoId = new Map([["", m.id]])
    g.dtoToFixtureId = new Map([[m.id, ""]])
    const { result, calls } = await run({
      source: sourceFrom([m]),
      grade: g,
      candidateRaw: JSON.stringify(basePayload(m)),
    })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_grading"])
    expect(calls.length).toBe(0)
  })

  test("lower witness cap never truncates grading", async () => {
    const { result, calls } = await run(
      { grade: grade([baseDto()], [witness(), witness()]) },
      { nowMs: () => 1000, maxWitnesses: 1 },
    )
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_grading"])
    expect(calls.length).toBe(0)
  })

  test("proxy or revoked witness array never reaches reflection traps", async () => {
    const g = grade()
    const revoked = Proxy.revocable([witness()], {})
    revoked.revoke()
    ;(g as { requiredEvidence: unknown }).requiredEvidence = revoked.proxy
    const { result, calls } = await run({ grade: g })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_grading"])
    expect(calls.length).toBe(0)
  })

  test("sparse or accessor witness indices never invoke getters", async () => {
    let n = 0
    const g1 = grade()
    const accessorWitnesses = [witness()]
    Object.defineProperty(accessorWitnesses, "0", {
      enumerable: true,
      get: () => {
        n++
        throw new Error("INDEX_TRAP")
      },
    })
    ;(g1 as { requiredEvidence: unknown }).requiredEvidence = accessorWitnesses
    const r1 = await run({ grade: g1 })
    expect(r1.result.outcome).toBe("gate_pending")
    expect(r1.result.codes).toEqual(["invalid_grading"])
    expect(r1.calls.length).toBe(0)

    const g2 = grade()
    ;(g2 as { requiredEvidence: unknown }).requiredEvidence = new Array(1)
    const r2 = await run({ grade: g2 })
    expect(r2.result.outcome).toBe("gate_pending")
    expect(r2.result.codes).toEqual(["invalid_grading"])
    expect(r2.calls.length).toBe(0)
    expect(n).toBe(0)
  })

  test("proxy grading envelope is invalid input without traps", async () => {
    let n = 0
    const proxied = new Proxy(grade(), {
      get: () => {
        n++
        throw new Error("GRADE_TRAP")
      },
    }) as PrivateGradingEnvelope
    const { result, calls } = await run({ grade: proxied })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_input"])
    expect(calls.length).toBe(0)
    expect(n).toBe(0)
  })

  test("known root accessors signal and candidateRaw run zero traps", async () => {
    let n = 0
    const withSignalGetter = make()
    Object.defineProperty(withSignalGetter, "signal", {
      enumerable: true,
      get: () => {
        n++
        throw new Error("SIGNAL_TRAP")
      },
    })
    withSignalGetter.judgePort = () => Promise.resolve(judgeDecision())
    const r1 = await evaluateDialogMemoryCase(withSignalGetter, {
      nowMs: () => 1000,
    })
    expect(r1.outcome).toBe("gate_pending")
    expect(r1.codes).toEqual(["invalid_input"])

    const withCandidateGetter = make()
    Object.defineProperty(withCandidateGetter, "candidateRaw", {
      enumerable: true,
      get: () => {
        n++
        throw new Error("CANDIDATE_TRAP")
      },
    })
    withCandidateGetter.judgePort = () => Promise.resolve(judgeDecision())
    const r2 = await evaluateDialogMemoryCase(withCandidateGetter, {
      nowMs: () => 1000,
    })
    expect(r2.outcome).toBe("gate_pending")
    expect(r2.codes).toEqual(["invalid_input"])
    expect(n).toBe(0)
  })

  test("missing candidateRaw is invalid input, explicit undefined is not a string", async () => {
    const missing = make()
    Reflect.deleteProperty(missing, "candidateRaw")
    missing.judgePort = () => Promise.resolve(judgeDecision())
    const r1 = await evaluateDialogMemoryCase(missing, {
      nowMs: () => 1000,
    })
    expect(r1.outcome).toBe("gate_pending")
    expect(r1.codes).toEqual(["invalid_input"])

    const { result: r2 } = await run({ candidateRaw: undefined })
    expect(r2.outcome).toBe("invalid_output")
    expect(r2.codes).toEqual(["candidate_not_a_string"])
  })

  test("non-object source scope is rejected before source delegation", async () => {
    const s = sourceFrom([baseDto()])
    ;(s as { scope: unknown }).scope = null
    const { result, calls } = await run({ source: s })
    expect(result.outcome).toBe("gate_pending")
    expect(result.codes).toEqual(["invalid_input"])
    expect(calls.length).toBe(0)
  })

  test("array judge envelope with plausible fields is inconclusive", async () => {
    const envelope = Object.assign([], {
      kind: "ok",
      content: JSON.stringify({
        version: 1,
        verdict: "pass",
        codes: ["faithful"],
      }),
    })
    const { result, calls } = await run({}, { nowMs: () => 1000 }, () =>
      Promise.resolve(envelope),
    )
    expect(result.outcome).toBe("inconclusive")
    expect(result.codes).toEqual(["judge_response_invalid"])
    expect(calls.length).toBe(1)
  })

  test("clock beats a failed judge response parse", async () => {
    let now = 1000
    const { result, calls } = await run({}, { nowMs: () => now }, () => {
      now = 2000
      return Promise.resolve({ kind: "ok" as const, content: "{bad" })
    })
    expect(result.outcome).toBe("not_tested")
    expect(result.codes).toEqual(["deadline"])
    expect(calls.length).toBe(1)
  })

  test("grading and coverage loops stop on their own clock", async () => {
    let sawWitnessClockStop = false
    for (let k = 1; k <= 64 && !sawWitnessClockStop; k++) {
      let ticks = 0
      const { result } = await run(
        {},
        {
          nowMs: () => {
            ticks += 1
            return ticks < k ? 1000 : 10_000
          },
        },
      )
      if (
        result.outcome === "not_tested" &&
        result.diagnostics?.phase === "witness"
      ) {
        sawWitnessClockStop = true
      }
    }
    expect(sawWitnessClockStop).toBe(true)
  })

  test("nonstring raw output never executes Proxy or toJSON", async () => {
    let n = 0
    const p = new Proxy(
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
    for (const candidateRaw of [
      p,
      {
        toJSON: () => {
          n++
          throw new Error("TOJSON")
        },
      },
      123,
    ]) {
      const { result, calls } = await run({ candidateRaw })
      expect(result.outcome).toBe("invalid_output")
      expect(result.codes).toEqual(["candidate_not_a_string"])
      expect(calls.length).toBe(0)
    }
    expect(n).toBe(0)
  })

  test("raw character cap checked before malformed JSON parse", async () => {
    const { result, calls } = await run({ candidateRaw: "x".repeat(20_001) })
    expect(result.outcome).toBe("invalid_output")
    expect(result.codes).toEqual(["candidate_output_oversize"])
    expect(calls.length).toBe(0)
  })

  test("malformed raw candidate JSON never invokes judge", async () => {
    const { result, calls } = await run({ candidateRaw: "{bad" })
    expect(result.outcome).toBe("invalid_output")
    expect(result.codes).toEqual(["candidate_invalid_output"])
    expect(calls.length).toBe(0)
  })

  test("lower judge packet budget blocks before port", async () => {
    const { result, calls } = await run(
      {},
      { nowMs: () => 1000, judgeBudget: { maxEncodedChars: 1 } },
    )
    expect(result.outcome).toBe("budget_blocked")
    expect(result.codes).toEqual(["judge_packet_oversize"])
    expect(calls.length).toBe(0)
  })

  test("invalid maxWitnesses and increased limits throw RangeError", async () => {
    await expect(
      run({}, { nowMs: () => 1000, maxWitnesses: 0 }),
    ).rejects.toThrow(RangeError)
    await expect(
      run(
        {},
        {
          nowMs: () => 1000,
          limits: { maxSourceItems: Number.MAX_SAFE_INTEGER },
        },
      ),
    ).rejects.toThrow(RangeError)
  })

  test("judge port receives whitelist fields and unused getters stay unread", async () => {
    const g = grade()
    const s = sourceFrom([baseDto()])
    let n = 0
    for (const k of [
      "forbiddenClaims",
      "expectedBehavior",
      "openQuestions",
    ] as const) {
      Object.defineProperty(g, k, {
        enumerable: true,
        get: () => {
          n++
          throw new Error("PRIVATE_GETTER")
        },
      })
    }
    Object.defineProperty(s, "eligibleHistory", {
      enumerable: true,
      get: () => {
        n++
        throw new Error("PRIVATE_SOURCE_GETTER")
      },
    })
    const { result, calls } = await run(
      { source: s, grade: g },
      { nowMs: () => 1000 },
      (call: JudgePortCall) => {
        expect(Object.keys(call).sort()).toEqual([
          "deadlineAtMs",
          "messages",
          "signal",
        ])
        expect(JSON.stringify(call).includes("PRIVATE_")).toBe(false)
        const data = JSON.parse(call.messages[1].content)
        expect(Object.keys(data).sort()).toEqual([
          "candidatePayload",
          "sourceMessages",
        ])
        return Promise.resolve(judgeDecision())
      },
    )
    expect(result.outcome).toBe("pass")
    expect(calls.length).toBe(1)
    expect(n).toBe(0)
  })

  test("judge callback cannot mutate captured grade counts source or case identity", async () => {
    const { result, calls } = await run(
      {},
      { nowMs: () => 1000 },
      (_call, input: EvaluateDialogMemoryCaseInput) => {
        input.grade.caseId = "MUTATED"
        ;(input.grade.requiredEvidence as ExpectedWitness[]).length = 0
        input.source.evidenceSnapshot = []
        return Promise.resolve(judgeDecision())
      },
    )
    expect(result.outcome).toBe("pass")
    expect(result.caseId).toBe("t06-c01")
    expect(result.coverage).toEqual({ required: 1, covered: 1 })
    expect(calls.length).toBe(1)
  })

  test("judge exception is constant transport_error with one attempt", async () => {
    const { result, calls } = await run({}, { nowMs: () => 1000 }, () =>
      Promise.reject(new Error("PRIVATE_REMOTE_ERROR")),
    )
    expect(result.outcome).toBe("transport_error")
    expect(result.codes).toEqual(["transport_error"])
    expect(JSON.stringify(result).includes("PRIVATE_")).toBe(false)
    expect(calls.length).toBe(1)
  })

  test("judge unavailable reasons never pass and never retry", async () => {
    const cases: [string, string, string][] = [
      ["deadline", "not_tested", "deadline"],
      ["cancelled", "not_tested", "cancelled"],
      ["transport_error", "transport_error", "transport_error"],
      ["invalid_output", "inconclusive", "judge_response_invalid"],
    ]
    for (const [reason, outcome, code] of cases) {
      const { result, calls } = await run({}, { nowMs: () => 1000 }, () =>
        Promise.resolve({ kind: "unavailable" as const, reason }),
      )
      expect(result.outcome).toBe(outcome)
      expect(result.codes).toEqual([code as EvalFailCode])
      expect(calls.length).toBe(1)
    }
  })

  test("invalid judge JSON and oversized response are inconclusive", async () => {
    let r = await run({}, { nowMs: () => 1000 }, () =>
      Promise.resolve({
        kind: "ok" as const,
        content: "{bad",
      }),
    )
    expect(r.result.outcome).toBe("inconclusive")
    expect(r.result.codes).toEqual(["judge_response_invalid"])
    expect(r.calls.length).toBe(1)

    r = await run({}, { nowMs: () => 1000 }, () =>
      Promise.resolve({
        kind: "ok" as const,
        content: " ".repeat(8193),
      }),
    )
    expect(r.result.outcome).toBe("inconclusive")
    expect(r.result.codes).toEqual(["judge_response_oversize"])
    expect(r.calls.length).toBe(1)
  })

  test("inconclusive judge decision cannot become pass", async () => {
    const { result, calls } = await run({}, { nowMs: () => 1000 }, () =>
      Promise.resolve(judgeDecision("inconclusive", ["uncertain"])),
    )
    expect(result.outcome).toBe("inconclusive")
    expect(result.codes).toEqual([])
    expect(result.judge?.verdict).toBe("inconclusive")
    expect(calls.length).toBe(1)
  })

  test("deadline and abort before port prevent calls", async () => {
    let r = await run({ deadlineAtMs: 999 })
    expect(r.result.outcome).toBe("not_tested")
    expect(r.result.codes).toEqual(["deadline"])
    expect(r.calls.length).toBe(0)

    const c = new AbortController()
    c.abort()
    r = await run({ signal: c.signal })
    expect(r.result.outcome).toBe("not_tested")
    expect(r.result.codes).toEqual(["cancelled"])
    expect(r.calls.length).toBe(0)
  })

  test("deadline after awaited pass wins", async () => {
    let now = 1000
    const { result, calls } = await run({}, { nowMs: () => now }, () => {
      now = 2000
      return Promise.resolve(judgeDecision())
    })
    expect(result.outcome).toBe("not_tested")
    expect(result.codes).toEqual(["deadline"])
    expect(calls.length).toBe(1)
  })

  test("deadline after rejected await wins over transport error", async () => {
    let now = 1000
    const { result, calls } = await run({}, { nowMs: () => now }, () => {
      now = 2000
      return Promise.reject(new Error("PRIVATE_REMOTE_ERROR"))
    })
    expect(result.outcome).toBe("not_tested")
    expect(result.codes).toEqual(["deadline"])
    expect(calls.length).toBe(1)
  })

  test("not_exercised and gate_pending dispositions never call judge", async () => {
    for (const [caseDisposition, outcome] of [
      ["not_exercised", "not_exercised"],
      ["gate_pending", "gate_pending"],
      ["unknown-future-kind", "gate_pending"],
    ] as const) {
      const { result, calls } = await run({
        caseDisposition: caseDisposition as CaseDisposition,
      })
      expect(result.outcome).toBe(outcome)
      expect(result.codes).toEqual([])
      expect(calls.length).toBe(0)
    }
  })

  test("disposition shortcuts ignore irrelevant invalid config", async () => {
    for (const caseDisposition of [
      "not_exercised",
      "gate_pending",
      "unknown-future-kind",
    ] as const) {
      const { result, calls } = await run(
        { caseDisposition: caseDisposition as CaseDisposition },
        { nowMs: () => 1000, maxWitnesses: 0 },
      )
      expect(result.outcome).toBe(
        caseDisposition === "not_exercised" ? "not_exercised" : "gate_pending",
      )
      expect(result.codes).toEqual([])
      expect(calls.length).toBe(0)
    }
  })

  test("malformed port envelopes are inconclusive without throwing", async () => {
    for (const val of [
      null,
      123,
      {},
      { kind: "unavailable", reason: "unknown" },
    ]) {
      const { result, calls } = await run({}, { nowMs: () => 1000 }, () =>
        Promise.resolve(val),
      )
      expect(result.outcome).toBe("inconclusive")
      expect(result.codes).toEqual(["judge_response_invalid"])
      expect(calls.length).toBe(1)
    }
  })
})
