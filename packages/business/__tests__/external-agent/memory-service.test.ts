/**
 * Synthetic in-memory port tests for the bounded dialog memory service.
 *
 * These tests exercise the public state machine using fake repository,
 * summarizer, and validator ports. They do not touch a real database or model.
 */

import type {
  DialogMemoryConfig,
  DialogMemoryDto,
  DialogMemoryMessageDto,
  DialogMemoryPublishInput,
  DialogMemoryPublishResult,
  DialogMemoryRegisterResult,
  DialogMemoryResetInput,
  DialogMemoryResetResult,
  DialogMemoryScope,
  DialogMemorySnapshotInput,
  DialogMemorySnapshotResult,
  DialogMemoryToken,
} from "@chatbotx.io/database/repositories"
import { describe, expect, test } from "vitest"
import {
  buildManifest,
  coverageRefOf,
  encodeStoredRecord,
  type StoredDialogMemoryRecord,
} from "../../src/external-agent/memory-coverage"
import { createDialogMemoryService } from "../../src/external-agent/memory-service"
import type {
  DialogMemoryBudgets,
  DialogMemoryRepositoryPort,
  DialogMemoryServiceConfig,
  SemanticValidatorPort,
  SummarizerPort,
} from "../../src/external-agent/memory-service-types"

const SCOPE: DialogMemoryScope = {
  workspaceId: "10",
  conversationId: "20",
  expectedContactId: "40",
}

const CONFIG: DialogMemoryConfig = {
  schemaVersion: 1,
  promptVersion: "test-v1",
  model: "test-model",
  provider: "test-provider",
}

const msg = (id: number, text = "Synthetic"): DialogMemoryMessageDto => ({
  id: String(id),
  createdAtMicros: `2026-11-11T00:00:00.${String(id).padStart(6, "0")}Z`,
  updatedAtMicros: "2026-11-11T00:00:01.000001Z",
  conversationId: "20",
  contactInboxId: "30",
  workspaceId: "10",
  text,
  contentAttributes: {},
  messageType: "incoming",
  contentType: "text",
  senderType: "contact",
  senderId: null,
  sourceId: null,
  deletedAtMicros: null,
  type: "message",
  parentId: null,
  attributes: {},
  sendError: null,
  attachments: [],
})

const ref = (m: DialogMemoryMessageDto) => ({
  id: m.id,
  createdAtMicros: m.createdAtMicros,
})

const storedRecord = (
  items: DialogMemoryMessageDto[],
  overrides?: Partial<StoredDialogMemoryRecord>,
): StoredDialogMemoryRecord => {
  const manifest = buildManifest(items)
  return {
    storageVersion: 1,
    manifestVersion: 1,
    validatorVersion: "test-validator",
    scope: structuredClone(SCOPE),
    config: structuredClone(CONFIG),
    coverage: coverageRefOf(manifest),
    coveredManifest: manifest,
    payload: { narrative: "SYNTHETIC_OLD_SUMMARY", evidence: [] },
    ...overrides,
  }
}

function makeMemory(record: StoredDialogMemoryRecord | null): DialogMemoryDto {
  return {
    workspaceId: "10",
    conversationId: "20",
    summary: record ? encodeStoredRecord(record) : null,
    ...CONFIG,
    memoryVersion: "1",
    coveredSourceRevision: record ? "1" : "0",
    topologyEpoch: "0",
    coverage: record ? structuredClone(record.coverage) : null,
    lastError: null,
    lastAttemptAt: null,
    createdAt: "2026-11-11T00:00:00.000001Z",
    updatedAt: "2026-11-11T00:00:00.000001Z",
  }
}

type HarnessOptions = {
  items?: DialogMemoryMessageDto[]
  record?: StoredDialogMemoryRecord
  readKind?: DialogMemorySnapshotResult["kind"]
  readConflictOnce?: boolean
  badOrder?: boolean
  duplicate?: boolean
  foreignItem?: boolean
  foreignAttachment?: boolean
  badNextCursor?: boolean
  memoryPatch?: Partial<DialogMemoryDto>
  generatedPayload?: unknown
  hangSummary?: boolean
  deadlineAfterRead?: boolean
  publishConflict?: boolean
  llmUnavailable?: boolean
  validatorReject?: boolean
  mutatePriorAndFail?: boolean
  sharedAcceptedPayload?: { narrative: string; evidence: string[] }
  mutateAcceptedOnPublish?: boolean
  nowMsFn?: () => number
  deadlineAtMs?: number
  budgets?: Partial<DialogMemoryBudgets>
}

type SummarizeInput = Parameters<SummarizerPort["summarize"]>[0]
type ValidateInput = Parameters<SemanticValidatorPort["validate"]>[0]

function harness(options: HarnessOptions = {}) {
  const items = structuredClone(options.items ?? [])
  const token: DialogMemoryToken = {
    sourceRevision: "1",
    memoryVersion: "1",
    topologyEpoch: "0",
  }
  let memory = makeMemory(options.record ?? null)

  const calls = {
    register: [] as { scope: DialogMemoryScope; config: DialogMemoryConfig }[],
    read: [] as DialogMemorySnapshotInput[],
    publish: [] as DialogMemoryPublishInput[],
    reset: [] as DialogMemoryResetInput[],
    summarize: [] as SummarizeInput[],
    validate: [] as ValidateInput[],
  }

  // Resolvers captured for the synthetic hang path and never invoked.
  const pendingSummaries: Array<(value: never) => void> = []

  let now = 0

  const repository: DialogMemoryRepositoryPort = {
    register(input) {
      calls.register.push(structuredClone(input))
      const result: DialogMemoryRegisterResult = {
        kind: "ok",
        token: structuredClone(token),
        memory: structuredClone(memory),
        created: false,
      }
      return Promise.resolve(result)
    },
    readSnapshot(input) {
      calls.read.push(structuredClone(input))
      if (options.readKind) {
        return Promise.resolve({
          kind: options.readKind,
          reason: "synthetic-upstream-reason",
        } as DialogMemorySnapshotResult)
      }
      if (options.readConflictOnce && calls.read.length === 1) {
        token.sourceRevision = "2"
        return Promise.resolve<DialogMemorySnapshotResult>({
          kind: "conflict",
          reason: "synthetic-stale",
        })
      }
      if (
        input.expectedToken &&
        (input.expectedToken.sourceRevision !== token.sourceRevision ||
          input.expectedToken.memoryVersion !== token.memoryVersion ||
          input.expectedToken.topologyEpoch !== token.topologyEpoch)
      ) {
        return Promise.resolve<DialogMemorySnapshotResult>({
          kind: "conflict",
          reason: "synthetic-stale",
        })
      }
      const desc = [...items].reverse()
      const cursor = input.cursor ?? null
      const start =
        cursor === null
          ? 0
          : desc.findIndex(
              (x) =>
                x.id === cursor.id &&
                x.createdAtMicros === cursor.createdAtMicros,
            ) + 1
      const limit = input.limit ?? 100
      let page = desc.slice(start, start + limit)
      if (options.badOrder) {
        page = [...page].reverse()
      }
      if (options.foreignItem) {
        page = page.map((x) => ({ ...x, workspaceId: "999" }))
      }
      if (options.foreignAttachment) {
        page = page.map((x) => ({
          ...x,
          attachments: [
            {
              id: "60",
              createdAtMicros: x.createdAtMicros,
              updatedAtMicros: x.updatedAtMicros,
              workspaceId: "10",
              conversationId: "20",
              messageId: "999",
              messageCreatedAtMicros: x.createdAtMicros,
              fileType: "file",
              sourceId: null,
              mimeType: "text/plain",
              width: null,
              height: null,
              size: 1,
              thumbnailPath: null,
              originPath: "test",
              name: "test",
            },
          ],
        }))
      }
      if (options.duplicate && page.length > 0) {
        const first = page[0]
        page = [first, first]
      }
      const hasMore = start + limit < desc.length
      if (options.deadlineAfterRead) {
        now = 100_001
      }
      const lastItem = page.at(-1)
      const issuedCursor =
        hasMore && lastItem !== undefined
          ? { id: lastItem.id, createdAtMicros: lastItem.createdAtMicros }
          : null
      let nextCursor = issuedCursor
      if (options.badNextCursor) {
        nextCursor = hasMore ? ref(msg(1)) : null
      }
      const result: DialogMemorySnapshotResult = {
        kind: "ok",
        scope: structuredClone(SCOPE),
        token: structuredClone(token),
        memory: { ...structuredClone(memory), ...options.memoryPatch },
        items: page,
        hasMore,
        nextCursor,
      }
      return Promise.resolve(result)
    },
    publishIfUnchanged(input) {
      calls.publish.push(structuredClone(input))
      if (options.mutateAcceptedOnPublish && options.sharedAcceptedPayload) {
        options.sharedAcceptedPayload.narrative =
          "SYNTHETIC_UNVALIDATED_AFTER_ACCEPT"
      }
      if (options.publishConflict) {
        return Promise.resolve<DialogMemoryPublishResult>({
          kind: "conflict",
          reason: "synthetic-stale",
        })
      }
      if (
        input.expectedToken.sourceRevision !== token.sourceRevision ||
        input.expectedToken.memoryVersion !== token.memoryVersion ||
        input.expectedToken.topologyEpoch !== token.topologyEpoch
      ) {
        return Promise.resolve<DialogMemoryPublishResult>({
          kind: "conflict",
          reason: "synthetic-stale",
        })
      }
      token.memoryVersion = (BigInt(token.memoryVersion) + 1n).toString()
      memory = {
        ...memory,
        ...input.config,
        summary: structuredClone(input.summary),
        coverage: structuredClone(input.coverage),
        memoryVersion: token.memoryVersion,
        coveredSourceRevision: token.sourceRevision,
        topologyEpoch: token.topologyEpoch,
      }
      const result: DialogMemoryPublishResult = {
        kind: "ok",
        token: structuredClone(token),
        memory: structuredClone(memory),
      }
      return Promise.resolve(result)
    },
    resetDerived(input) {
      calls.reset.push(structuredClone(input))
      const result: DialogMemoryResetResult = {
        kind: "conflict",
        reason: "synthetic-explicit-reset-CAS",
      }
      return Promise.resolve(result)
    },
  }

  const summarizer: SummarizerPort = {
    summarize(input) {
      calls.summarize.push(structuredClone(input))
      if (options.mutatePriorAndFail) {
        // Adversarial port: rewrites the prior payload in place, then fails.
        const prior = input.priorPayload as { narrative?: string } | null
        if (prior !== null && typeof prior === "object") {
          prior.narrative = "SYNTHETIC_PRIOR_POISON"
        }
        return Promise.resolve({
          kind: "unavailable" as const,
          reason: "SYNTHETIC_PRIVATE_REASON",
        })
      }
      if (options.hangSummary) {
        // Never settles on its own; the service must race this against the
        // absolute deadline and must not observe any late resolution.
        return new Promise<never>((resolve) => {
          pendingSummaries.push(resolve)
        })
      }
      if (options.generatedPayload !== undefined) {
        return Promise.resolve({
          kind: "ok" as const,
          payload: structuredClone(options.generatedPayload),
        })
      }
      if (options.llmUnavailable) {
        return Promise.resolve({
          kind: "unavailable" as const,
          reason: "SYNTHETIC_PRIVATE_REASON",
        })
      }
      return Promise.resolve({
        kind: "ok" as const,
        payload: { narrative: "Synthetic accepted summary", evidence: [] },
      })
    },
  }

  const validator: SemanticValidatorPort = {
    validate(input) {
      calls.validate.push(structuredClone(input))
      if (options.validatorReject) {
        return Promise.resolve({
          kind: "reject" as const,
          reason: "SYNTHETIC_PRIVATE_REASON",
        })
      }
      if (options.sharedAcceptedPayload) {
        // Returns the port-held object the test mutates during publish.
        return Promise.resolve({
          kind: "accept" as const,
          payload: options.sharedAcceptedPayload,
        })
      }
      return Promise.resolve({
        kind: "accept" as const,
        payload: structuredClone(input.candidatePayload),
      })
    },
  }

  const config: DialogMemoryServiceConfig = {
    scope: structuredClone(SCOPE),
    config: structuredClone(CONFIG),
    validatorVersion: "test-validator",
    deadlineAtMs: options.deadlineAtMs ?? 100_000,
    nowMs: options.nowMsFn ?? (() => now),
    budgets: { pageSize: 2, ...options.budgets },
  }

  const service = createDialogMemoryService({
    repository,
    summarizer,
    validator,
    config,
  })

  return {
    service,
    calls,
    items,
    config,
    get memory() {
      return memory
    },
    get token() {
      return token
    },
  }
}

describe("createDialogMemoryService", () => {
  test("empty source avoids LLM and publish", async () => {
    const h = harness()
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.summaryRecord).toBeNull()
    expect(r.afterCoverageRaw).toHaveLength(0)
    expect(h.calls.summarize).toHaveLength(0)
    expect(h.calls.publish).toHaveLength(0)
  })

  test("lazy small source avoids LLM", async () => {
    const h = harness({ items: [msg(1)] })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.summaryRecord).toBeNull()
    expect(r.afterCoverageRaw).toHaveLength(1)
    expect(h.calls.summarize).toHaveLength(0)
    expect(h.calls.publish).toHaveLength(0)
  })

  test("three DESC pages become global ASC", async () => {
    const h = harness({ items: [1, 2, 3, 4, 5, 6].map((x) => msg(x)) })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.afterCoverageRaw.map((x) => x.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ])
    expect(h.calls.read).toHaveLength(3)
  })

  test("first page pinned and cursors are issued, not coverage-derived", async () => {
    const old = storedRecord([msg(1), msg(2)])
    const h = harness({
      items: [1, 2, 3, 4, 5, 6].map((x) => msg(x)),
      record: old,
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    expect(h.calls.read[0].cursor ?? null).toBeNull()
    for (const call of h.calls.read) {
      expect(call.expectedToken).toEqual({
        sourceRevision: "1",
        memoryVersion: "1",
        topologyEpoch: "0",
      })
    }
    expect(h.calls.read[1].cursor).toEqual(ref(msg(5)))
    expect(h.calls.read[2].cursor).toEqual(ref(msg(3)))
  })

  test("valid prefix retained with uncovered raw and false completeness", async () => {
    const old = storedRecord([msg(1)])
    const h = harness({ items: [msg(1), msg(2)], record: old })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.summaryRecord).toEqual(old)
    expect(r.afterCoverageRaw).toHaveLength(1)
    expect(r.afterCoverageRaw[0].id).toBe("2")
    expect(r.completePrefix).toBe(false)
    expect(h.calls.summarize).toHaveLength(0)
  })

  test("full summary means true coverage", async () => {
    const old = storedRecord([msg(1)])
    const h = harness({ items: [msg(1)], record: old })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.completePrefix).toBe(true)
    expect(r.afterCoverageRaw).toHaveLength(0)
  })

  test("covered edit rebuilds and never returns stale summary", async () => {
    const h = harness({
      items: [msg(1, "changed")],
      record: storedRecord([msg(1)]),
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.summaryRecord).toBeNull()
    expect(r.afterCoverageRaw[0].text).toBe("changed")
    expect(h.calls.reset).toHaveLength(0)
  })

  test("backdated insertion rebuilds", async () => {
    const h = harness({
      items: [msg(1), msg(2), msg(3)],
      record: storedRecord([msg(2)]),
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.summaryRecord).toBeNull()
    expect(r.afterCoverageRaw).toHaveLength(3)
  })

  test("hard delete all does not return cached summary", async () => {
    const h = harness({ items: [], record: storedRecord([msg(1)]) })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.summaryRecord).toBeNull()
    expect(r.afterCoverageRaw).toHaveLength(0)
    expect(h.calls.publish).toHaveLength(0)
  })

  test("uncovered edit preserves prefix", async () => {
    const h = harness({
      items: [msg(1), msg(2, "changed tail")],
      record: storedRecord([msg(1)]),
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.summaryRecord).not.toBeNull()
    expect(r.afterCoverageRaw).toHaveLength(1)
    expect(r.afterCoverageRaw[0].text).toBe("changed tail")
  })

  test("foreign scope cache is never trusted", async () => {
    const old = storedRecord([msg(1)])
    old.scope.expectedContactId = "999"
    const h = harness({ items: [msg(1)], record: old })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.summaryRecord).toBeNull()
  })

  test("incompatible validator cache is never trusted", async () => {
    const old = storedRecord([msg(1)])
    old.validatorVersion = "old-version"
    const h = harness({ items: [msg(1)], record: old })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.summaryRecord).toBeNull()
  })

  for (const kind of [
    "not_found",
    "unregistered",
    "unsupported",
    "inconsistent",
  ]) {
    test(`upstream ${kind} is propagated, not converted to empty data`, async () => {
      const h = harness({
        items: [msg(1)],
        readKind: kind as DialogMemorySnapshotResult["kind"],
      })
      const r = await h.service.getTrustedContext()
      expect(r.kind).toBe(kind)
      if (r.kind === kind) {
        expect(r.reason).toBe("synthetic-upstream-reason")
      }
      expect(h.calls.publish).toHaveLength(0)
    })
  }

  test("out-of-order snapshot is rejected without publishing", async () => {
    const h = harness({ items: [msg(1), msg(2)], badOrder: true })
    const r = await h.service.getTrustedContext()
    expect(r.kind).not.toBe("ok")
    expect(h.calls.publish).toHaveLength(0)
  })

  test("duplicate snapshot ref is rejected without publishing", async () => {
    const h = harness({ items: [msg(1), msg(2)], duplicate: true })
    const r = await h.service.getTrustedContext()
    expect(r.kind).not.toBe("ok")
    expect(h.calls.publish).toHaveLength(0)
  })

  test("scan budget never returns partial raw", async () => {
    const h = harness({
      items: [1, 2, 3, 4, 5, 6].map((x) => msg(x)),
      budgets: { maxPageFetches: 1 },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("context_unavailable")
    if (r.kind !== "context_unavailable") {
      return
    }
    expect(r.reason).toBe("insufficient_scan")
    expect(h.calls.publish).toHaveLength(0)
    expect(h.calls.read).toHaveLength(1)
  })

  test("long source is compressed only after semantic accept", async () => {
    const h = harness({
      items: [msg(1, "x".repeat(5000))],
      budgets: { maxOutputEncodedChars: 2000 },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.summaryRecord).not.toBeNull()
    expect(r.afterCoverageRaw).toHaveLength(0)
    expect(r.completePrefix).toBe(true)
    expect(h.calls.summarize).toHaveLength(1)
    expect(h.calls.validate).toHaveLength(1)
    expect(h.calls.publish).toHaveLength(1)
    expect(h.calls.publish[0].coverage).toEqual(ref(h.items[0]))
    expect(h.calls.validate[0].sourceEvidence).toEqual(h.items)
    expect(h.calls.read).toHaveLength(1)
  })

  test("validator rejection never publishes", async () => {
    const h = harness({
      items: [msg(1, "x".repeat(5000))],
      validatorReject: true,
      budgets: { maxOutputEncodedChars: 2000 },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("context_unavailable")
    if (r.kind !== "context_unavailable") {
      return
    }
    expect(r.reason).toBe("validator_reject")
    expect(h.calls.publish).toHaveLength(0)
    expect(JSON.stringify(r).includes("SYNTHETIC_PRIVATE_REASON")).toBe(false)
  })

  test("LLM unavailable with oversized raw fails closed", async () => {
    const h = harness({
      items: [msg(1, "x".repeat(5000))],
      llmUnavailable: true,
      budgets: { maxOutputEncodedChars: 2000 },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("context_unavailable")
    if (r.kind !== "context_unavailable") {
      return
    }
    expect(r.reason).toBe("llm_unavailable")
    expect(h.calls.publish).toHaveLength(0)
    expect(h.calls.reset).toHaveLength(0)
  })

  test("two CAS losses are bounded and previous memory is preserved", async () => {
    const old = storedRecord([msg(1)])
    const h = harness({
      items: [msg(1), msg(2, "x".repeat(5000))],
      record: old,
      publishConflict: true,
      budgets: {
        maxOutputEncodedChars: 2000,
        maxCycles: 2,
        maxLlmCalls: 2,
      },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("context_unavailable")
    if (r.kind !== "context_unavailable") {
      return
    }
    expect(r.reason).toBe("stale_conflict")
    expect(h.calls.publish).toHaveLength(2)
    expect(h.calls.summarize).toHaveLength(2)
    expect(h.memory.summary).toEqual(encodeStoredRecord(old))
    expect(h.calls.reset).toHaveLength(0)
  })

  test("read conflict restarts whole scan, not empty result", async () => {
    const h = harness({ items: [msg(1)], readConflictOnce: true })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(h.calls.register).toHaveLength(2)
    expect(h.calls.read).toHaveLength(2)
    expect(r.afterCoverageRaw).toEqual(h.items)
    expect(r.token.sourceRevision).toBe("2")
  })

  test("explicit reset passes caller CAS, no hidden register", async () => {
    const h = harness()
    const expectedToken: DialogMemoryToken = {
      sourceRevision: "3",
      memoryVersion: "4",
      topologyEpoch: "0",
    }
    const r = await h.service.reset({ expectedToken })
    expect(r.kind).toBe("conflict")
    expect(h.calls.reset).toEqual([{ scope: SCOPE, expectedToken }])
    expect(h.calls.register).toHaveLength(0)
  })

  test("constructor detaches config before awaiting", async () => {
    const h = harness({ items: [msg(1)] })
    h.config.scope.conversationId = "999"
    h.config.config.provider = "changed"
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    expect(h.calls.register[0]).toEqual({ scope: SCOPE, config: CONFIG })
  })

  test("deadline after read stops publication", async () => {
    const h = harness({
      items: [msg(1, "x".repeat(5000))],
      deadlineAfterRead: true,
      budgets: { maxOutputEncodedChars: 2000 },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("context_unavailable")
    if (r.kind !== "context_unavailable") {
      return
    }
    expect(r.reason).toBe("deadline")
    expect(h.calls.publish).toHaveLength(0)
  })

  test("already cancelled signal starts no repository calls", async () => {
    const h = harness()
    const ac = new AbortController()
    ac.abort()
    const r = await h.service.getTrustedContext({ signal: ac.signal })
    expect(r.kind).toBe("context_unavailable")
    if (r.kind !== "context_unavailable") {
      return
    }
    expect(r.reason).toBe("cancelled")
    expect(h.calls.register).toHaveLength(0)
  })

  test("invalid budget is rejected before IO", () => {
    expect(() =>
      harness({
        budgets: { maxCycles: 0 },
      }),
    ).toThrow()
  })

  test("coverage cursor is never passed to readSnapshot", async () => {
    const old = storedRecord([msg(1)])
    const h = harness({ items: [msg(1), msg(2)], record: old })
    await h.service.getTrustedContext()
    for (const call of h.calls.read) {
      const c = call as DialogMemorySnapshotInput & { cursor?: unknown }
      if (c.cursor !== undefined && c.cursor !== null) {
        expect(c.cursor).not.toEqual(ref(msg(1)))
      }
    }
  })

  test("hasMore=false does not imply full coverage", async () => {
    const old = storedRecord([msg(1)])
    const h = harness({ items: [msg(1), msg(2)], record: old })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.completePrefix).toBe(false)
  })

  test("foreign message workspace fails closed", async () => {
    const h = harness({ items: [msg(1)], foreignItem: true })
    const r = await h.service.getTrustedContext()
    expect(r.kind).not.toBe("ok")
    expect(h.calls.publish).toHaveLength(0)
  })

  test("foreign attachment parent fails closed", async () => {
    const h = harness({ items: [msg(1)], foreignAttachment: true })
    const r = await h.service.getTrustedContext()
    expect(r.kind).not.toBe("ok")
    expect(h.calls.publish).toHaveLength(0)
  })

  test("unissued cursor cannot skip middle history", async () => {
    const h = harness({
      items: [1, 2, 3, 4].map((x) => msg(x)),
      badNextCursor: true,
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).not.toBe("ok")
    expect(h.calls.publish).toHaveLength(0)
  })

  test("item budget is enforced after the final page", async () => {
    const h = harness({
      items: [msg(1), msg(2)],
      budgets: { maxScanItems: 1 },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("context_unavailable")
    if (r.kind !== "context_unavailable") {
      return
    }
    expect(r.reason).toBe("insufficient_scan")
    expect(h.calls.publish).toHaveLength(0)
  })

  test("byte budget is enforced after the final page", async () => {
    const h = harness({
      items: [msg(1)],
      budgets: { maxScanLogicalBytes: 1 },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("context_unavailable")
    if (r.kind !== "context_unavailable") {
      return
    }
    expect(r.reason).toBe("insufficient_scan")
    expect(h.calls.publish).toHaveLength(0)
  })

  test("old row config rebuilds rather than failing globally", async () => {
    const h = harness({
      items: [msg(1)],
      memoryPatch: { promptVersion: "previous" },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(r.summaryRecord).toBeNull()
    expect(r.afterCoverageRaw).toHaveLength(1)
  })

  test("memory version inconsistent with pinned token is rejected", async () => {
    const h = harness({
      items: [msg(1)],
      memoryPatch: { memoryVersion: "999" },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).not.toBe("ok")
    expect(h.calls.publish).toHaveLength(0)
  })

  test("stored budget counts UTF-8 bytes before publish", async () => {
    const h = harness({
      items: [msg(1, "x".repeat(5000))],
      generatedPayload: { narrative: "я".repeat(5000) },
      budgets: {
        maxOutputEncodedChars: 2000,
        maxStoredJsonBytes: 7000,
        maxBatchEncodedChars: 6000,
      },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("context_unavailable")
    if (r.kind !== "context_unavailable") {
      return
    }
    expect(r.reason).toBe("oversize")
    expect(h.calls.publish).toHaveLength(0)
  })

  test("hard maxLlmCalls cannot be configured unbounded", () => {
    expect(() => harness({ budgets: { maxLlmCalls: 100_000 } })).toThrow()
  })

  test("hard maxCycles cannot be configured unbounded", () => {
    expect(() => harness({ budgets: { maxCycles: 100_000 } })).toThrow()
  })

  test("hung generator returns on the absolute deadline", async () => {
    const h = harness({
      items: [msg(1, "x".repeat(5000))],
      hangSummary: true,
      nowMsFn: Date.now,
      deadlineAtMs: Date.now() + 30,
      budgets: { maxOutputEncodedChars: 2000 },
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const outerTimeout = new Promise<{ kind: "outer-timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "outer-timeout" }), 150)
    })
    const r = await Promise.race([h.service.getTrustedContext(), outerTimeout])
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    expect(r.kind).toBe("context_unavailable")
    if (r.kind !== "context_unavailable") {
      return
    }
    expect(r.reason).toBe("deadline")
    expect(h.calls.publish).toHaveLength(0)
  })

  test("validator-held payload mutated in publish is not delivered", async () => {
    const held: { narrative: string; evidence: string[] } = {
      narrative: "SYNTHETIC_VALIDATED",
      evidence: [],
    }
    const h = harness({
      items: [msg(1, "x".repeat(5000))],
      sharedAcceptedPayload: held,
      mutateAcceptedOnPublish: true,
      budgets: { maxOutputEncodedChars: 2000 },
    })
    const r = await h.service.getTrustedContext()
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") {
      return
    }
    expect(h.calls.publish).toHaveLength(1)
    // The port really mutated its held object inside the publish callback.
    expect(held.narrative).toBe("SYNTHETIC_UNVALIDATED_AFTER_ACCEPT")
    const record = r.summaryRecord
    expect(record).not.toBeNull()
    if (record === null) {
      return
    }
    expect(record.payload).toEqual({
      narrative: "SYNTHETIC_VALIDATED",
      evidence: [],
    })
    const stored = h.memory.summary as { payload: unknown }
    expect(record.payload).toEqual(stored.payload)
    expect(record.payload).not.toBe(held)
  })

  test("failed summarizer cannot deliver a poisoned old summary", async () => {
    const old = storedRecord([msg(1)])
    old.payload = { narrative: "v".repeat(10_000), evidence: [] }
    const h = harness({
      items: [msg(1), msg(2)],
      record: old,
      mutatePriorAndFail: true,
      budgets: { maxOutputEncodedChars: 2000, pageSize: 1 },
    })
    const r = await h.service.getTrustedContext()
    expect(h.calls.summarize).toHaveLength(1)
    expect(h.calls.summarize[0].priorPayload).toEqual(old.payload)
    if (r.kind === "ok" && r.summaryRecord !== null) {
      expect(r.summaryRecord.payload).toEqual(old.payload)
    }
    expect(JSON.stringify(r)).not.toContain("SYNTHETIC_PRIOR_POISON")
    expect(h.memory.summary).toEqual(encodeStoredRecord(old))
    expect(h.calls.publish).toHaveLength(0)
  })
})
