import { createRequire } from "node:module"
import { describe, expect, test, vi } from "vitest"
import {
  LIVE_EXECUTION_AUTHORIZED,
  planDialogMemoryRun,
  RUNNER_VERSION,
  type RunnerRequest,
} from "../../../../scripts/eval-dialog-memory"
import { loadDialogMemoryDatasetBytes } from "../../../../scripts/lib/eval-dialog-memory-dataset-bytes"

const nodeFs = createRequire(import.meta.url)(
  "node:fs",
) as typeof import("node:fs")

const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value))

const syntheticEnvelope = () => ({
  schemaVersion: 2,
  synthetic: true,
  notes: "",
  humanApproved: false,
  dataStatus: "machine_candidate",
  evaluationTarget: "memory_on_full_source",
  sourceSelectionPolicy: "all_after_state_messages_except_deleted",
  currentMessageIdsMeaning: "request_window_only",
  cases: [
    {
      id: "synthetic-c01",
      split: "development",
      scenario: "synthetic",
      messages: [
        {
          id: "msg-1",
          createdAt: "2024-01-01T00:00:00.000000Z",
          role: "contact",
          channel: "web",
          text: "BODY_SENTINEL_ALPHA",
          orderId: null,
        },
      ],
      currentMessageIds: ["msg-1"],
      requiredEvidence: [
        {
          messageId: "msg-1",
          quote: "BODY_SENTINEL_ALPHA",
          kind: "client_claim",
          orderId: null,
        },
      ],
      openQuestions: [],
      forbiddenClaims: [],
      expectedBehavior: "synthetic",
    },
  ],
})

const request = (dataset: Uint8Array, dryRun: boolean): RunnerRequest => ({
  dataset,
  stage: "a1",
  retries: 0,
  calls: [{ model: "kimi-k3", count: 1 }],
  dryRun,
})

const datasetCodeOf = (bytes: Uint8Array): string => {
  const loaded = loadDialogMemoryDatasetBytes(bytes)
  if (loaded.kind === "invalid") {
    return loaded.code
  }
  if (loaded.preflight.kind === "invalid") {
    return loaded.preflight.code
  }
  return "valid"
}

describe("eval-dialog-memory runner", () => {
  test("runtime exports stay unauthorized", () => {
    expect(RUNNER_VERSION).toBe("t08-runner-v1")
    expect(LIVE_EXECUTION_AUTHORIZED).toBe(false)
    expect(typeof planDialogMemoryRun).toBe("function")
  })

  test("a live request does not read dataset or calls", () => {
    let reads = 0
    const live = {
      stage: "a1",
      retries: 0,
      dryRun: false,
    }
    Object.defineProperty(live, "dataset", {
      enumerable: true,
      get() {
        reads += 1
        return new Uint8Array()
      },
    })
    Object.defineProperty(live, "calls", {
      enumerable: true,
      get() {
        reads += 1
        return []
      },
    })
    expect(planDialogMemoryRun(live as unknown as RunnerRequest)).toEqual({
      kind: "refused",
      code: "live_run_forbidden",
    })
    expect(reads).toBe(0)
  })

  test("an extra credential is invalid and silent", () => {
    const result = planDialogMemoryRun({
      ...request(new Uint8Array(), true),
      apiKey: "API_KEY_SENTINEL",
    } as unknown as RunnerRequest)
    expect(result).toEqual({ kind: "refused", code: "invalid_request" })
    expect(JSON.stringify(result)).not.toContain("API_KEY_SENTINEL")
  })

  test("a throwing request proxy is invalid without the trap", () => {
    let traps = 0
    const proxy = new Proxy(request(new Uint8Array(), true), {
      get() {
        traps += 1
        throw new Error("proxy trap")
      },
    })
    expect(planDialogMemoryRun(proxy)).toEqual({
      kind: "refused",
      code: "invalid_request",
    })
    expect(traps).toBe(0)
  })

  test("a revoked request proxy is invalid without throwing", () => {
    const { proxy, revoke } = Proxy.revocable(
      request(new Uint8Array(), true),
      {},
    )
    revoke()
    expect(planDialogMemoryRun(proxy)).toEqual({
      kind: "refused",
      code: "invalid_request",
    })
  })

  test("a non-boolean dry run is invalid", () => {
    expect(
      planDialogMemoryRun({
        ...request(new Uint8Array(), true),
        dryRun: "yes",
      } as unknown as RunnerRequest),
    ).toEqual({ kind: "refused", code: "invalid_request" })
  })

  test("a dataset getter is not called", () => {
    let reads = 0
    const planned = {
      stage: "a1",
      retries: 0,
      calls: [],
      dryRun: true,
    }
    Object.defineProperty(planned, "dataset", {
      enumerable: true,
      get() {
        reads += 1
        return new Uint8Array()
      },
    })
    expect(planDialogMemoryRun(planned as unknown as RunnerRequest)).toEqual({
      kind: "refused",
      code: "invalid_request",
    })
    expect(reads).toBe(0)
  })

  test("a plain array dataset is invalid", () => {
    expect(
      planDialogMemoryRun({
        ...request(new Uint8Array(), true),
        dataset: [1, 2, 3],
      } as unknown as RunnerRequest),
    ).toEqual({ kind: "refused", code: "invalid_request" })
  })

  test("loader failures stay dataset_rejected without the body", () => {
    const broken = encode({ nope: true })
    const brokenCode = datasetCodeOf(broken)
    expect(brokenCode).not.toBe("valid")
    expect(planDialogMemoryRun(request(broken, true))).toEqual({
      kind: "refused",
      code: "dataset_rejected",
      datasetCode: brokenCode,
    })
    const synthetic = encode(syntheticEnvelope())
    const syntheticCode = datasetCodeOf(synthetic)
    expect(syntheticCode).not.toBe("valid")
    const result = planDialogMemoryRun(request(synthetic, true))
    expect(result).toEqual({
      kind: "refused",
      code: "dataset_rejected",
      datasetCode: syntheticCode,
    })
    expect(JSON.stringify(result)).not.toContain("BODY_SENTINEL_ALPHA")
  })

  test("fetch, the api key, and writes stay unused", () => {
    const planned = request(encode({ nope: true }), true)
    const before = JSON.stringify(planned.calls)
    const previousFetch = globalThis.fetch
    const previousEnv = process.env
    const fetchSpy = vi.fn(() => {
      throw new Error("FETCH")
    })
    let keyReads = 0
    let writes = 0
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch
    process.env = new Proxy(previousEnv, {
      get(target, key, receiver) {
        if (key === "OLLAMA_API_KEY") {
          keyReads += 1
        }
        return Reflect.get(target, key, receiver)
      },
    })
    const previousWrite = nodeFs.writeFileSync
    nodeFs.writeFileSync = (() => {
      writes += 1
      throw new Error("WRITE")
    }) as typeof nodeFs.writeFileSync
    try {
      const first = planDialogMemoryRun(planned)
      const second = planDialogMemoryRun(planned)
      expect(first).toEqual(second)
      expect(JSON.stringify(planned.calls)).toBe(before)
      expect(Object.isFrozen(planned)).toBe(false)
      expect(JSON.stringify(first)).not.toContain("true")
      expect(fetchSpy).toHaveBeenCalledTimes(0)
      expect(keyReads).toBe(0)
      expect(writes).toBe(0)
    } finally {
      globalThis.fetch = previousFetch
      process.env = previousEnv
      nodeFs.writeFileSync = previousWrite
    }
  })
})
