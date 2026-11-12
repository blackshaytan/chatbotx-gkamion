import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import {
  DATASET_BYTES_VERSION,
  loadDialogMemoryDatasetBytes,
  loadDialogMemoryDatasetFile,
} from "../../../../scripts/lib/eval-dialog-memory-dataset-bytes"
import { validateFrozenManifestBatch } from "../../../../scripts/lib/eval-dialog-memory-preflight"

const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value))

const makeMinimalCase = (id: string, split: "development" | "holdout") => ({
  id,
  split,
  scenario: `scenario-${id}`,
  messages: [
    {
      id: "msg-1",
      createdAt: "2024-01-01T00:00:00.000000Z",
      role: "contact",
      channel: "web",
      text: "hello world",
      orderId: null,
    },
  ],
  currentMessageIds: ["msg-1"],
  requiredEvidence: [
    {
      messageId: "msg-1",
      quote: "hello",
      kind: "client_claim",
      orderId: null,
    },
  ],
  openQuestions: [],
  forbiddenClaims: [],
  expectedBehavior: "remember greeting",
})

const makeEnvelope = (cases: unknown[]) => ({
  schemaVersion: 2,
  synthetic: true,
  notes: "",
  humanApproved: false,
  dataStatus: "machine_candidate",
  evaluationTarget: "memory_on_full_source",
  sourceSelectionPolicy: "all_after_state_messages_except_deleted",
  currentMessageIdsMeaning: "request_window_only",
  cases,
})

const cases30 = Array.from({ length: 30 }, (_, i) => {
  const num = i + 1
  const id = `t06-c${num.toString().padStart(2, "0")}`
  const split = i < 20 ? "development" : "holdout"
  return makeMinimalCase(id, split)
})

describe("eval-dialog-memory-dataset-bytes", () => {
  test("exports version constant and both loader functions", () => {
    expect(DATASET_BYTES_VERSION).toBe("t08-dataset-bytes-v1")
    expect(typeof loadDialogMemoryDatasetBytes).toBe("function")
    expect(typeof loadDialogMemoryDatasetFile).toBe("function")
  })

  describe("SHA-256 hashing", () => {
    test("hashes the exact passed Uint8Array bytes", () => {
      const bytes = encode(
        makeEnvelope([makeMinimalCase("t06-c01", "development")]),
      )
      const result = loadDialogMemoryDatasetBytes(bytes)
      expect(result.kind).toBe("checked")
      if (result.kind === "checked") {
        expect(result.datasetSha256).toBe(
          createHash("sha256").update(bytes).digest("hex"),
        )
      }
    })

    test("hashes a subarray view without underlying buffer padding", () => {
      const bytes = encode(
        makeEnvelope([makeMinimalCase("t06-c01", "development")]),
      )
      const buffer = new ArrayBuffer(bytes.length + 10)
      const fullView = new Uint8Array(buffer)
      fullView.set(bytes, 5)
      const subarray = fullView.subarray(5, 5 + bytes.length)
      const result = loadDialogMemoryDatasetBytes(subarray)
      expect(result.kind).toBe("checked")
      if (result.kind === "checked") {
        expect(result.datasetSha256).toBe(
          createHash("sha256").update(bytes).digest("hex"),
        )
      }
    })

    test("digest includes a UTF-8 BOM that the decoder strips", () => {
      const body = encode(
        makeEnvelope([makeMinimalCase("t06-c01", "development")]),
      )
      const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...body])
      const result = loadDialogMemoryDatasetBytes(withBom)
      expect(result.kind).toBe("checked")
      if (result.kind === "checked") {
        expect(result.datasetSha256).toBe(
          createHash("sha256").update(withBom).digest("hex"),
        )
      }
    })

    test("different whitespace produces different digests for identical identities", () => {
      const envelope = makeEnvelope([makeMinimalCase("t06-c01", "development")])
      const compact = encode(envelope)
      const pretty = new TextEncoder().encode(JSON.stringify(envelope, null, 2))
      const compactResult = loadDialogMemoryDatasetBytes(compact)
      const prettyResult = loadDialogMemoryDatasetBytes(pretty)
      expect(compactResult.kind).toBe("checked")
      expect(prettyResult.kind).toBe("checked")
      if (compactResult.kind === "checked" && prettyResult.kind === "checked") {
        expect(compactResult.caseIdentities).toEqual(
          prettyResult.caseIdentities,
        )
        expect(compactResult.datasetSha256).not.toBe(prettyResult.datasetSha256)
      }
    })

    test("pretty-printed bytes are not re-hashed via compact JSON.stringify", () => {
      const envelope = makeEnvelope([makeMinimalCase("t06-c01", "development")])
      const pretty = new TextEncoder().encode(JSON.stringify(envelope, null, 2))
      const parsed = JSON.parse(new TextDecoder().decode(pretty))
      const compactOfParsed = new TextEncoder().encode(JSON.stringify(parsed))
      const result = loadDialogMemoryDatasetBytes(pretty)
      expect(result.kind).toBe("checked")
      if (result.kind === "checked") {
        expect(result.datasetSha256).toBe(
          createHash("sha256").update(pretty).digest("hex"),
        )
        expect(result.datasetSha256).not.toBe(
          createHash("sha256").update(compactOfParsed).digest("hex"),
        )
      }
    })
  })

  describe("envelope validation", () => {
    test.each([
      ["humanApproved true", { ...makeEnvelope([]), humanApproved: true }],
      ["extra key", { ...makeEnvelope([]), extra: "surprise" }],
      ["missing key", { ...makeEnvelope([]), cases: undefined }],
      ["non-object string", "not an object"],
      ["non-object array", [1, 2, 3]],
      ["bad schemaVersion", { ...makeEnvelope([]), schemaVersion: 3 }],
      ["bad synthetic", { ...makeEnvelope([]), synthetic: false }],
      ["bad dataStatus", { ...makeEnvelope([]), dataStatus: "gold" }],
      ["bad evaluationTarget", { ...makeEnvelope([]), evaluationTarget: "x" }],
      [
        "bad sourceSelectionPolicy",
        { ...makeEnvelope([]), sourceSelectionPolicy: "x" },
      ],
      [
        "bad currentMessageIdsMeaning",
        { ...makeEnvelope([]), currentMessageIdsMeaning: "x" },
      ],
      ["non-string notes", { ...makeEnvelope([]), notes: 123 }],
      ["non-array cases", { ...makeEnvelope([]), cases: "cases" }],
    ])("envelope failure (%s) returns dataset_schema_mismatch without adapterReason", (_label, envelope) => {
      const result = loadDialogMemoryDatasetBytes(encode(envelope))
      expect(result).toEqual({
        kind: "invalid",
        code: "dataset_schema_mismatch",
      })
    })
  })

  test("adapter failure returns case_decode_rejected with adapterReason only", () => {
    const badCase = {
      ...makeMinimalCase("t06-c01", "development"),
      requiredEvidence: [
        {
          messageId: "msg-1",
          quote: "this text is not present",
          kind: "client_claim",
          orderId: null,
        },
      ],
    }
    const result = loadDialogMemoryDatasetBytes(encode(makeEnvelope([badCase])))
    expect(result).toEqual({
      kind: "invalid",
      code: "case_decode_rejected",
      adapterReason: "invalid_expected_evidence",
    })
  })

  test("29 decoded cases returns identity_count_mismatch with identities in order", () => {
    const cases29 = cases30.slice(0, 29)
    const result = loadDialogMemoryDatasetBytes(encode(makeEnvelope(cases29)))
    expect(result.kind).toBe("checked")
    if (result.kind === "checked") {
      expect(result.caseIdentities).toHaveLength(29)
      expect(result.caseIdentities[0].id).toBe("t06-c01")
      expect(result.caseIdentities[28].id).toBe("t06-c29")
      expect(result.preflight).toEqual(
        validateFrozenManifestBatch({
          datasetSha256: result.datasetSha256,
          caseIdentities: result.caseIdentities,
        }),
      )
      expect(result.preflight).toEqual({
        kind: "invalid",
        code: "identity_count_mismatch",
      })
    }
  })

  test("30 decoded cases in non-manifest order keep order and preflight reports dataset_hash_mismatch", () => {
    const reordered = [cases30[1], cases30[0], ...cases30.slice(2)]
    const result = loadDialogMemoryDatasetBytes(encode(makeEnvelope(reordered)))
    expect(result.kind).toBe("checked")
    if (result.kind === "checked") {
      expect(result.caseIdentities[0].id).toBe("t06-c02")
      expect(result.caseIdentities[1].id).toBe("t06-c01")
      expect(result.caseIdentities[2].id).toBe("t06-c03")
      expect(result.preflight).toEqual({
        kind: "invalid",
        code: "dataset_hash_mismatch",
      })
    }
  })

  test("canary strings are absent from serialized checked result", () => {
    const canary = "CANARY-STRING-THAT-MUST-NOT-LEAK-INTO-RESULT"
    const baseCase = makeMinimalCase("t06-c01", "development")
    const caseWithCanary = {
      ...baseCase,
      scenario: canary,
      messages: baseCase.messages.map((message) => ({
        ...message,
        text: canary,
      })),
      requiredEvidence: baseCase.requiredEvidence.map((evidence) => ({
        ...evidence,
        quote: canary,
      })),
      openQuestions: [canary],
      forbiddenClaims: [canary],
      expectedBehavior: canary,
      mutation: { canary },
    }
    const envelope = makeEnvelope([caseWithCanary])
    envelope.notes = canary
    const result = loadDialogMemoryDatasetBytes(encode(envelope))
    expect(result.kind).toBe("checked")
    if (result.kind === "checked") {
      expect(JSON.stringify(result)).not.toContain(canary)
      for (const identity of result.caseIdentities) {
        expect(Object.getOwnPropertyNames(identity).sort()).toEqual([
          "id",
          "split",
        ])
      }
    }
  })

  describe("bytes input rejection", () => {
    test("proxy bytes returns invalid_bytes without traps", () => {
      const bytes = encode(
        makeEnvelope([makeMinimalCase("t06-c01", "development")]),
      )
      const { proxy } = Proxy.revocable(bytes, {})
      const result = loadDialogMemoryDatasetBytes(proxy)
      expect(result).toEqual({ kind: "invalid", code: "invalid_bytes" })
    })

    test("revoked proxy bytes returns invalid_bytes without throwing", () => {
      const bytes = encode(
        makeEnvelope([makeMinimalCase("t06-c01", "development")]),
      )
      const { proxy, revoke } = Proxy.revocable(bytes, {})
      revoke()
      expect(() => loadDialogMemoryDatasetBytes(proxy)).not.toThrow()
      expect(loadDialogMemoryDatasetBytes(proxy)).toEqual({
        kind: "invalid",
        code: "invalid_bytes",
      })
    })

    test.each([
      ["string", "not bytes"],
      ["ArrayBuffer", new ArrayBuffer(8)],
      ["DataView", new DataView(new ArrayBuffer(8))],
      ["Int8Array", new Int8Array(8)],
    ])("%s input returns invalid_bytes", (_label, value) => {
      const result = loadDialogMemoryDatasetBytes(
        value as unknown as Uint8Array,
      )
      expect(result).toEqual({ kind: "invalid", code: "invalid_bytes" })
    })

    test("invalid UTF-8 bytes returns invalid_utf8", () => {
      const result = loadDialogMemoryDatasetBytes(new Uint8Array([0xff]))
      expect(result).toEqual({ kind: "invalid", code: "invalid_utf8" })
    })
  })

  describe("file loader", () => {
    test("file round-trip of synthetic bytes returns checked", () => {
      const bytes = encode(
        makeEnvelope([makeMinimalCase("t06-c01", "development")]),
      )
      const tmpDir = mkdtempSync(join(tmpdir(), "dialog-memory-dataset-bytes-"))
      const filePath = join(tmpDir, "dataset.json")
      writeFileSync(filePath, bytes)
      const result = loadDialogMemoryDatasetFile(filePath)
      expect(result.kind).toBe("checked")
      if (result.kind === "checked") {
        expect(result.datasetSha256).toBe(
          createHash("sha256").update(bytes).digest("hex"),
        )
      }
    })

    test("missing file path returns dataset_unreadable without echoing path", () => {
      const path = "/nonexistent/path/to/dialog-memory-dataset.json"
      const result = loadDialogMemoryDatasetFile(path)
      expect(result).toEqual({ kind: "invalid", code: "dataset_unreadable" })
      expect(JSON.stringify(result)).not.toContain(path)
    })

    test("non-string file path returns invalid_path", () => {
      const result = loadDialogMemoryDatasetFile(123 as unknown as string)
      expect(result).toEqual({ kind: "invalid", code: "invalid_path" })
    })
  })

  test("input Uint8Array is unchanged after call", () => {
    const bytes = encode(makeEnvelope(cases30))
    const before = new Uint8Array(bytes)
    loadDialogMemoryDatasetBytes(bytes)
    expect(bytes).toEqual(before)
  })
})
