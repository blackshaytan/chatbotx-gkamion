import { describe, expect, test } from "vitest"
import type { MemoryPayload } from "../../../../packages/business/src/external-agent/memory-contract"
import { buildSummarizeRequest } from "../../../../packages/business/src/external-agent/memory-prompt"
import { evaluateDialogMemoryCase } from "../../../../scripts/lib/eval-dialog-memory-evaluator"
import {
  adaptDialogMemoryCase,
  type PrivateGradingEnvelope,
} from "../../../../scripts/lib/eval-dialog-memory-fixture-adapter"
import { buildJudgeRequest } from "../../../../scripts/lib/eval-dialog-memory-judge"

const scope = {
  workspaceId: "1",
  conversationId: "2",
  expectedContactId: "4",
}

const clock = { nowMs: () => 0 }

const wordBearingFixture = {
  id: "t06-c07",
  split: "development" as const,
  scenario: "CANARY_SCENARIO_ONLY",
  messages: [
    {
      id: "m-old",
      createdAt: "2026-01-02T03:04:05.123456Z",
      role: "contact" as const,
      channel: "email",
      text: "OLD_FACT_OUTSIDE_WINDOW",
      orderId: null,
    },
    {
      id: "m-now",
      createdAt: "2026-01-03T03:04:05Z",
      role: "contact" as const,
      channel: "email",
      text: "CURRENT_WINDOW requiredEvidence https://example.invalid/cb",
      orderId: null,
    },
  ],
  currentMessageIds: ["m-now"],
  requiredEvidence: [
    {
      messageId: "m-old",
      quote: "OLD_FACT_OUTSIDE_WINDOW",
      kind: "client_claim" as const,
      orderId: null,
    },
  ],
  openQuestions: ["CANARY_OPEN_ONLY"],
  forbiddenClaims: ["CANARY_FORBIDDEN_ONLY"],
  expectedBehavior: "CANARY_EXPECTED_ONLY",
  mutation: { marker: "CANARY_MUTATION_ONLY" },
}

const plainFixture = {
  id: "t06-c08",
  split: "development" as const,
  scenario: "CANARY_SCENARIO_ONLY",
  messages: [
    {
      id: "m-plain-old",
      createdAt: "2026-01-02T03:04:05.123456Z",
      role: "contact" as const,
      channel: "email",
      text: "PLAIN_OLD_FACT",
      orderId: null,
    },
    {
      id: "m-plain-now",
      createdAt: "2026-01-03T03:04:05Z",
      role: "contact" as const,
      channel: "email",
      text: "PLAIN_CURRENT",
      orderId: null,
    },
  ],
  currentMessageIds: ["m-plain-now"],
  requiredEvidence: [
    {
      messageId: "m-plain-old",
      quote: "PLAIN_OLD_FACT",
      kind: "client_claim" as const,
      orderId: null,
    },
  ],
  openQuestions: ["CANARY_OPEN_ONLY"],
  forbiddenClaims: ["CANARY_FORBIDDEN_ONLY"],
  expectedBehavior: "CANARY_EXPECTED_ONLY",
  mutation: { marker: "CANARY_MUTATION_ONLY" },
}

type Fixture = typeof wordBearingFixture

const runCase = async (
  fixture: Fixture,
  oldText: string,
  newText: string,
  expectRequiredEvidence: boolean,
) => {
  const adapted = adaptDialogMemoryCase(
    {
      caseJson: JSON.stringify(fixture),
      scope: { ...scope },
      deadlineAtMs: 1000,
    },
    clock,
  )

  expect(adapted.kind).toBe("ok")
  if (adapted.kind !== "ok") {
    return
  }

  expect(adapted.source.eligibleHistory.some((m) => m.text === oldText)).toBe(
    true,
  )

  const oldMessage = adapted.source.eligibleHistory.find(
    (m) => m.text === oldText,
  )
  if (oldMessage === undefined) {
    throw new Error("missing old message")
  }

  const summarizeRequest = buildSummarizeRequest(
    {
      mode: "rebuild",
      batch: adapted.source.eligibleHistory,
      evidence: adapted.source.evidenceSnapshot,
      priorPayload: null,
      scope: adapted.source.scope,
      deadlineAtMs: 1000,
      budget: { maxEncodedChars: 24_000 },
    },
    clock,
  )

  expect(summarizeRequest.kind).toBe("ok")
  if (summarizeRequest.kind !== "ok") {
    return
  }

  const candidatePayload: MemoryPayload = {
    version: 1,
    facts: [
      {
        attribution: "contact",
        quotes: [
          {
            ref: {
              id: oldMessage.id,
              createdAtMicros: oldMessage.createdAtMicros,
            },
            text: oldMessage.text ?? "",
          },
        ],
      },
    ],
    narrative: { text: "summary", nonAuthoritative: true },
    openQuestions: [],
  }

  const grade = {
    ...adapted.grading,
    declaredKind: "CANARY_DECLARED_KIND",
    dispositionReason: "CANARY_MANIFEST_REASON",
  }

  const judgeRequest = buildJudgeRequest(
    {
      sourceEvidence: adapted.source.evidenceSnapshot,
      candidatePayload,
      scope: adapted.source.scope,
      deadlineAtMs: 1000,
    },
    clock,
  )

  expect(judgeRequest.kind).toBe("ok")
  if (judgeRequest.kind !== "ok") {
    return
  }

  let portKeys: string[] = []
  let portMessagesJson = ""

  const result = await evaluateDialogMemoryCase(
    {
      source: adapted.source,
      candidateRaw: JSON.stringify(candidatePayload),
      grade: grade as unknown as PrivateGradingEnvelope,
      mode: "rebuild",
      priorPayload: null,
      caseDisposition: "eligible",
      deadlineAtMs: 1000,
      judgePort: (call) => {
        portKeys = Object.keys(call)
        portMessagesJson = JSON.stringify(call.messages)
        return Promise.resolve({
          kind: "ok",
          content: JSON.stringify({
            version: 1,
            verdict: "pass",
            codes: ["faithful"],
          }),
        })
      },
    },
    clock,
  )

  expect(result.outcome).toBe("pass")
  expect(result.caseId).toBe(fixture.id)

  const candidateJson = JSON.stringify(summarizeRequest.messages)
  const directJudgeJson = JSON.stringify(judgeRequest.messages)

  for (const serialized of [candidateJson, directJudgeJson, portMessagesJson]) {
    expect(serialized).toContain(oldText)
  }

  const extractSourceMessages = (serialized: string) => {
    const messages = JSON.parse(serialized) as { content: string }[]
    const data = JSON.parse(messages[1].content) as {
      sourceMessages: { text: string }[]
    }
    return data.sourceMessages
  }

  for (const serialized of [candidateJson, directJudgeJson, portMessagesJson]) {
    const sourceMessages = extractSourceMessages(serialized)
    expect(sourceMessages.some((m) => m.text === newText)).toBe(true)
  }

  const canaries = [
    "CANARY_SCENARIO_ONLY",
    "CANARY_OPEN_ONLY",
    "CANARY_FORBIDDEN_ONLY",
    "CANARY_EXPECTED_ONLY",
    "CANARY_MUTATION_ONLY",
    "CANARY_DECLARED_KIND",
    "CANARY_MANIFEST_REASON",
    fixture.id,
    "forbiddenClaims",
    "expectedBehavior",
  ]

  const messageIds = fixture.messages.map((m) => m.id)

  for (const serialized of [candidateJson, directJudgeJson, portMessagesJson]) {
    for (const sentinel of canaries) {
      expect(serialized).not.toContain(sentinel)
    }
    for (const id of messageIds) {
      expect(serialized).not.toContain(id)
    }
    if (expectRequiredEvidence) {
      expect(serialized).toContain("requiredEvidence")
    } else {
      expect(serialized).not.toContain("requiredEvidence")
    }
  }

  const resultJson = JSON.stringify(result)
  for (const sentinel of [
    "CANARY_SCENARIO_ONLY",
    "CANARY_OPEN_ONLY",
    "CANARY_FORBIDDEN_ONLY",
    "CANARY_EXPECTED_ONLY",
    "CANARY_MUTATION_ONLY",
    "CANARY_DECLARED_KIND",
    "CANARY_MANIFEST_REASON",
  ]) {
    expect(resultJson).not.toContain(sentinel)
  }

  expect(portKeys.sort()).toEqual(["deadlineAtMs", "messages", "signal"])
}

describe("eval-dialog-memory-packet-isolation", () => {
  test("word-bearing fixture t06-c07 preserves requiredEvidence and URL", async () => {
    await runCase(
      wordBearingFixture,
      "OLD_FACT_OUTSIDE_WINDOW",
      "CURRENT_WINDOW requiredEvidence https://example.invalid/cb",
      true,
    )
  })

  test("plain fixture t06-c08 excludes grader-only canaries and requiredEvidence", async () => {
    await runCase(plainFixture, "PLAIN_OLD_FACT", "PLAIN_CURRENT", false)
  })
})
