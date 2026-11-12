import { describe, expect, test } from "vitest"
import {
  attachmentFingerprint,
  buildFingerprintedRef,
  buildManifest,
  compareRefsAsc,
  coverageRefOf,
  decodeStoredRecord,
  diffManifest,
  encodeStoredRecord,
  isFullCoverage,
  MANIFEST_VERSION,
  MESSAGE_REF_FORMAT_VERSION,
  messageFingerprint,
  STORAGE_VERSION,
} from "../../src/external-agent/memory-coverage"

const HEX64_RE = /^[0-9a-f]{64}$/

const baseAttachment = (
  id: string,
  parent: ReturnType<typeof baseMessage>,
) => ({
  id,
  createdAtMicros: parent.createdAtMicros,
  updatedAtMicros: parent.updatedAtMicros,
  workspaceId: parent.workspaceId,
  conversationId: parent.conversationId,
  messageId: parent.id,
  messageCreatedAtMicros: parent.createdAtMicros,
  fileType: "file",
  sourceId: null,
  mimeType: "text/plain",
  width: null,
  height: null,
  size: 1,
  thumbnailPath: null,
  originPath: "synthetic/file",
  name: "test.txt",
})

const baseMessage = (id = "9007199254740993", micros = "000001") => ({
  id,
  createdAtMicros: `2026-11-11T00:00:00.${micros}Z`,
  updatedAtMicros: "2026-11-11T00:00:01.000001Z",
  conversationId: "20",
  contactInboxId: "30",
  workspaceId: "10",
  text: "Synthetic replica",
  contentAttributes: { a: 1, b: { x: 2, y: 3 } },
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

const ref = (message: ReturnType<typeof baseMessage>) => ({
  id: message.id,
  createdAtMicros: message.createdAtMicros,
})

const manifest = (items: ReturnType<typeof baseMessage>[]) =>
  buildManifest(items)

const storedRecord = (items: ReturnType<typeof baseMessage>[]) => {
  const m = manifest(items)
  return {
    storageVersion: 1 as const,
    manifestVersion: 1 as const,
    validatorVersion: "synthetic-v1",
    scope: {
      workspaceId: "10",
      conversationId: "20",
      expectedContactId: "40",
    },
    config: {
      schemaVersion: 1,
      promptVersion: "synthetic-v1",
      model: "test-model",
      provider: "test-provider",
    },
    coverage: coverageRefOf(m),
    coveredManifest: m,
    payload: { narrative: "Synthetic check", evidence: [] },
  }
}

const encodedRecord = (items: ReturnType<typeof baseMessage>[]) =>
  encodeStoredRecord(storedRecord(items)) as Record<string, unknown>

describe("constants", () => {
  test("version constants are frozen to 1", () => {
    expect(MESSAGE_REF_FORMAT_VERSION).toBe(1)
    expect(STORAGE_VERSION).toBe(1)
    expect(MANIFEST_VERSION).toBe(1)
  })
})

describe("compareRefsAsc", () => {
  const a = baseMessage()
  const b = baseMessage("9007199254740994")
  const c = baseMessage("9007199254740995", "000002")

  test("equal micros decide BigInt id without precision loss", () => {
    expect(compareRefsAsc(ref(a), ref(b))).toBeLessThan(0)
  })

  test("microseconds distinguish refs", () => {
    expect(compareRefsAsc(ref(b), ref(c))).toBeLessThan(0)
  })

  test("equal refs compare to zero", () => {
    expect(compareRefsAsc(ref(a), ref(a))).toBe(0)
  })

  test("rejects non-canonical ids by throwing", () => {
    expect(() =>
      compareRefsAsc({ id: "01", createdAtMicros: a.createdAtMicros }, ref(a)),
    ).toThrow()
  })
})

describe("messageFingerprint", () => {
  const a = baseMessage()

  test("returns lowercase 64-char hex", () => {
    const hash = messageFingerprint(a)
    expect(hash).toMatch(HEX64_RE)
  })

  test("is stable under nested object key reorder", () => {
    const reordered = {
      ...a,
      contentAttributes: { b: { y: 3, x: 2 }, a: 1 },
    }
    expect(messageFingerprint(a)).toBe(messageFingerprint(reordered))
  })

  test("ignores message updatedAtMicros", () => {
    const updated = { ...a, updatedAtMicros: "2026-11-12T00:00:00.000001Z" }
    expect(messageFingerprint(a)).toBe(messageFingerprint(updated))
  })

  test.each([
    ["text", "Different text"],
    ["senderType", "bot"],
    ["senderId", "50"],
    ["deletedAtMicros", "2026-11-12T00:00:00.000001Z"],
    ["contentAttributes", { new: true }],
    ["attributes", { new: true }],
    ["messageType", "outgoing"],
    ["contentType", "activity"],
    ["contactInboxId", "31"],
    ["type", "comment"],
    ["sourceId", "external-2"],
    ["sendError", "synthetic send failure"],
    ["parentId", "51"],
  ])("changes when meaningful field %s is mutated", (key, value) => {
    const mutated = { ...a, [key]: value }
    expect(messageFingerprint(a)).not.toBe(messageFingerprint(mutated))
  })

  test("detects attachment mutation", () => {
    const withAttachment = { ...a, attachments: [baseAttachment("60", a)] }
    const altered = {
      ...withAttachment,
      attachments: [{ ...withAttachment.attachments[0], name: "other.txt" }],
    }
    expect(messageFingerprint(withAttachment)).not.toBe(
      messageFingerprint(altered),
    )
  })

  test("attachment order is stable without mutating input", () => {
    const withAttachments = {
      ...a,
      attachments: [baseAttachment("61", a), baseAttachment("60", a)],
    }
    const before = JSON.stringify(withAttachments)
    const reversed = {
      ...withAttachments,
      attachments: [...withAttachments.attachments].reverse(),
    }
    expect(messageFingerprint(withAttachments)).toBe(
      messageFingerprint(reversed),
    )
    expect(JSON.stringify(withAttachments)).toBe(before)
  })
})

describe("attachmentFingerprint", () => {
  test("ignores attachment updatedAtMicros", () => {
    const a = baseMessage()
    const att = baseAttachment("60", a)
    const updated = { ...att, updatedAtMicros: "2026-11-12T00:00:00.000001Z" }
    expect(attachmentFingerprint(att)).toBe(attachmentFingerprint(updated))
  })
})

describe("buildManifest / buildFingerprintedRef / coverageRefOf", () => {
  const a = baseMessage()
  const b = baseMessage("9007199254740994")

  test("empty manifest and coverage", () => {
    expect(buildManifest([])).toEqual([])
    expect(coverageRefOf([])).toBeNull()
  })

  test("builds fingerprinted refs in order", () => {
    const m = buildManifest([a, b])
    expect(m).toHaveLength(2)
    expect(m[0]).toEqual(buildFingerprintedRef(a))
    expect(m[1]).toEqual(buildFingerprintedRef(b))
  })

  test("coverageRefOf returns detached copy of last ref", () => {
    const m = manifest([a, b])
    const coverage = coverageRefOf(m)
    expect(coverage).toEqual({ id: b.id, createdAtMicros: b.createdAtMicros })
    if (!coverage) {
      throw new Error("expected coverage")
    }
    coverage.id = "mutated"
    expect(m.at(-1)?.id).toBe(b.id)
  })

  test("rejects non-strict-asc input", () => {
    expect(() => buildManifest([b, a])).toThrow()
  })

  test("rejects duplicate refs", () => {
    expect(() => buildManifest([a, a])).toThrow()
  })
})

describe("diffManifest", () => {
  const a = baseMessage()
  const b = baseMessage("9007199254740994")
  const c = baseMessage("9007199254740995", "000002")

  test("append tail exact", () => {
    const d = diffManifest(manifest([a]), [a, b, c])
    expect(d).toEqual({ kind: "append", coveredCount: 1, uncovered: [b, c] })
  })

  test("backdated insert forces rebuild", () => {
    const early = baseMessage("8", "000000")
    expect(diffManifest(manifest([a]), [early, a, b])).toEqual({
      kind: "rebuild",
      reason: "missing_or_backdated",
    })
  })

  test("hard deleted covered ref forces rebuild", () => {
    expect(diffManifest(manifest([a, b]), [b, c])).toEqual({
      kind: "rebuild",
      reason: "missing_or_backdated",
    })
  })

  test("covered edit forces fingerprint mismatch rebuild", () => {
    expect(diffManifest(manifest([a]), [{ ...a, text: "edited" }, b])).toEqual({
      kind: "rebuild",
      reason: "fingerprint_mismatch",
    })
  })

  test("uncovered edit preserves prefix and appends", () => {
    expect(diffManifest(manifest([a]), [a, { ...b, text: "edited" }])).toEqual({
      kind: "append",
      coveredCount: 1,
      uncovered: [{ ...b, text: "edited" }],
    })
  })

  test("descending stream rejected as order violation", () => {
    expect(diffManifest(manifest([a]), [b, a])).toEqual({
      kind: "rebuild",
      reason: "order_violation",
    })
  })

  test("duplicate stream rejected as order violation", () => {
    expect(diffManifest(manifest([a]), [a, a])).toEqual({
      kind: "rebuild",
      reason: "order_violation",
    })
  })

  test("malformed manifest order rejected", () => {
    expect(diffManifest([...manifest([a, b])].reverse(), [a, b])).toEqual({
      kind: "rebuild",
      reason: "order_violation",
    })
  })

  test("empty old manifest appends all current items", () => {
    expect(diffManifest([], [a, b])).toEqual({
      kind: "append",
      coveredCount: 0,
      uncovered: [a, b],
    })
  })

  test("empty current with non-empty old rebuilds", () => {
    expect(diffManifest(manifest([a]), [])).toEqual({
      kind: "rebuild",
      reason: "missing_or_backdated",
    })
  })
})

describe("isFullCoverage", () => {
  const a = baseMessage()
  const b = baseMessage("9007199254740994")
  const m = manifest([a, b])

  test("true when refs and fingerprints match exactly", () => {
    expect(isFullCoverage(m, [a, b])).toBe(true)
  })

  test("false when equal count but fingerprint differs", () => {
    expect(isFullCoverage(m, [a, { ...b, text: "edited" }])).toBe(false)
  })

  test("true when both manifest and stream are empty", () => {
    expect(isFullCoverage([], [])).toBe(true)
  })

  test("false when stream is longer", () => {
    expect(
      isFullCoverage(m, [a, b, baseMessage("9007199254740995", "000002")]),
    ).toBe(false)
  })
})

describe("encodeStoredRecord / decodeStoredRecord", () => {
  const a = baseMessage()
  const b = baseMessage("9007199254740994")

  test("roundtrip returns detached record", () => {
    const r = storedRecord([a, b])
    const encoded = encodeStoredRecord(r)
    const decoded = decodeStoredRecord(encoded)
    expect(decoded.kind).toBe("ok")
    if (decoded.kind !== "ok") {
      return
    }
    expect(decoded.record).toEqual(r)
    r.payload.narrative = "mutated"
    expect((decoded.record.payload as { narrative: string }).narrative).toBe(
      "Synthetic check",
    )
  })

  test("empty record with null coverage is valid", () => {
    const decoded = decodeStoredRecord(encodeStoredRecord(storedRecord([])))
    expect(decoded.kind).toBe("ok")
    if (decoded.kind !== "ok") {
      return
    }
    expect(decoded.record.coverage).toBeNull()
    expect(decoded.record.coveredManifest).toEqual([])
  })

  test("rejects unsupported storage version", () => {
    const encoded = encodedRecord([a, b])
    const mutated = { ...encoded, storageVersion: 2 }
    expect(decodeStoredRecord(mutated).kind).toBe("invalid")
  })

  test("rejects empty validator version", () => {
    const r = storedRecord([a, b])
    expect(
      decodeStoredRecord({ ...r, validatorVersion: "" } as never).kind,
    ).toBe("invalid")
  })

  test("rejects missing coverage field", () => {
    const encoded = encodedRecord([a, b])
    const { coverage: _, ...mutated } = encoded
    expect(decodeStoredRecord(mutated).kind).toBe("invalid")
  })

  test("rejects missing payload field", () => {
    const encoded = encodedRecord([])
    const { payload: _p, ...mutated } = encoded
    expect(decodeStoredRecord(mutated).kind).toBe("invalid")
  })

  test("accepts explicit null payload", () => {
    const r = storedRecord([])
    ;(r as { payload: unknown }).payload = null
    const decoded = decodeStoredRecord(r)
    expect(decoded.kind).toBe("ok")
    if (decoded.kind !== "ok") {
      return
    }
    expect(decoded.record.payload).toBeNull()
  })

  test.each([
    ["empty", [] as number[]],
    ["nonempty", [1] as number[]],
  ])("rejects %s Array-subclass payload", (_, arr) => {
    class TestArray extends Array<number> {}
    Object.setPrototypeOf(arr, TestArray.prototype)
    const r = storedRecord([])
    ;(r as { payload: unknown }).payload = arr
    expect(decodeStoredRecord(r).kind).toBe("invalid")
  })

  test("rejects coverage mismatch", () => {
    const encoded = {
      ...encodedRecord([a, b]),
      coverage: ref(baseMessage("999", "999999")),
    }
    expect(decodeStoredRecord(encoded).kind).toBe("invalid")
  })

  test("rejects non-canonical id", () => {
    const encoded = encodedRecord([a, b])
    const manifest = (encoded as { coveredManifest: { id: string }[] })
      .coveredManifest
    manifest[0].id = "01"
    expect(decodeStoredRecord(encoded).kind).toBe("invalid")
  })

  test("rejects invalid calendar timestamp", () => {
    const encoded = encodedRecord([a, b])
    const manifest = (
      encoded as { coveredManifest: { createdAtMicros: string }[] }
    ).coveredManifest
    manifest[0].createdAtMicros = "2026-02-30T00:00:00.000001Z"
    expect(decodeStoredRecord(encoded).kind).toBe("invalid")
  })

  test("rejects bad fingerprint hash", () => {
    const encoded = encodedRecord([a, b])
    const manifest = (encoded as { coveredManifest: { fingerprint: string }[] })
      .coveredManifest
    manifest[0].fingerprint = "not-a-hash"
    expect(decodeStoredRecord(encoded).kind).toBe("invalid")
  })

  test("rejects non-object root", () => {
    expect(decodeStoredRecord(null).kind).toBe("invalid")
    expect(decodeStoredRecord("string").kind).toBe("invalid")
  })

  test("rejects manifest non-array", () => {
    const encoded = { ...encodedRecord([a, b]), coveredManifest: "bad" }
    expect(decodeStoredRecord(encoded).kind).toBe("invalid")
  })

  test("rejects non-empty manifest with null coverage", () => {
    const encoded = { ...encodedRecord([a, b]), coverage: null }
    expect(decodeStoredRecord(encoded).kind).toBe("invalid")
  })

  test("rejects empty manifest with non-null coverage", () => {
    const encoded = { ...encodedRecord([]), coverage: ref(a) }
    expect(decodeStoredRecord(encoded).kind).toBe("invalid")
  })

  test("rejects duplicate refs in manifest", () => {
    const encoded = encodedRecord([a, b])
    const manifest = (encoded as { coveredManifest: unknown[] }).coveredManifest
    manifest[1] = manifest[0]
    expect(decodeStoredRecord(encoded).kind).toBe("invalid")
  })

  test("rejects out-of-order manifest", () => {
    const encoded = encodedRecord([a, b])
    const manifest = (encoded as { coveredManifest: unknown[] }).coveredManifest
    manifest.reverse()
    expect(decodeStoredRecord(encoded).kind).toBe("invalid")
  })
})

describe("edge cases", () => {
  test("decode accepts PostgreSQL bigint max id and rejects overflow", () => {
    const a = baseMessage()
    const encoded = encodedRecord([a])
    const mutable = encoded as unknown as {
      coveredManifest: { id: string }[]
      coverage: { id: string }
    }
    mutable.coveredManifest[0].id = "9223372036854775807"
    mutable.coverage.id = "9223372036854775807"
    expect(decodeStoredRecord(encoded).kind).toBe("ok")
    mutable.coveredManifest[0].id = "9223372036854775808"
    mutable.coverage.id = "9223372036854775808"
    expect(decodeStoredRecord(encoded).kind).toBe("invalid")
  })

  test("decode accepts leap year and rejects invalid calendar date", () => {
    const a = baseMessage()
    const encoded = encodedRecord([a])
    const mutable = encoded as unknown as {
      coveredManifest: { createdAtMicros: string }[]
      coverage: { createdAtMicros: string }
    }
    mutable.coveredManifest[0].createdAtMicros = "2024-02-29T00:00:00.000001Z"
    mutable.coverage.createdAtMicros = "2024-02-29T00:00:00.000001Z"
    expect(decodeStoredRecord(encoded).kind).toBe("ok")
    mutable.coveredManifest[0].createdAtMicros = "2023-02-29T00:00:00.000001Z"
    mutable.coverage.createdAtMicros = "2023-02-29T00:00:00.000001Z"
    expect(decodeStoredRecord(encoded).kind).toBe("invalid")
  })

  test("ids above 2^53 compare correctly", () => {
    const big1 = baseMessage("9007199254740993")
    const big2 = baseMessage("9007199254740994")
    expect(compareRefsAsc(ref(big1), ref(big2))).toBeLessThan(0)
  })
})

describe("edge regressions", () => {
  const a = baseMessage()

  test("compareRefsAsc rejects non-canonical ids", () => {
    expect(() =>
      compareRefsAsc({ id: "01", createdAtMicros: a.createdAtMicros }, ref(a)),
    ).toThrow()
  })

  test.each([
    ["undefined", undefined],
    ["function", () => 1],
    ["bigint", 1n],
    ["symbol", Symbol("x")],
    ["non-finite", Number.POSITIVE_INFINITY],
    ["Date", new Date("2026-01-01T00:00:00Z")],
  ] as [
    string,
    unknown,
  ][])("messageFingerprint rejects %s attribute", (_, value) => {
    expect(() =>
      messageFingerprint({ ...a, attributes: { bad: value } }),
    ).toThrow()
  })

  test("messageFingerprint rejects getter without invoking it", () => {
    let calls = 0
    const attrs: Record<string, unknown> = {}
    Object.defineProperty(attrs, "bad", {
      enumerable: true,
      get() {
        calls++
        return "changed"
      },
    })
    expect(() => messageFingerprint({ ...a, attributes: attrs })).toThrow()
    expect(calls).toBe(0)
  })

  test("decodeStoredRecord never invokes root getter", () => {
    let calls = 0
    const r = storedRecord([a])
    Object.defineProperty(r, "storageVersion", {
      enumerable: true,
      get() {
        calls++
        return 1
      },
    })
    expect(decodeStoredRecord(r).kind).toBe("invalid")
    expect(calls).toBe(0)
  })

  test("decodeStoredRecord preserves own __proto__ literal", () => {
    const r = storedRecord([a])
    ;(r as { payload: unknown }).payload = JSON.parse(
      '{"__proto__":{"literal":true},"normal":1}',
    )
    const decoded = decodeStoredRecord(r)
    expect(decoded.kind).toBe("ok")
    if (decoded.kind !== "ok") {
      return
    }
    expect(Object.hasOwn(decoded.record.payload as object, "__proto__")).toBe(
      true,
    )
    expect(decoded.record.payload).toEqual((r as { payload: unknown }).payload)
    expect(Object.getPrototypeOf(decoded.record.payload as object)).toBe(
      Object.prototype,
    )
  })

  test("decodeStoredRecord rejects symbol payload key", () => {
    const r = storedRecord([a])
    ;(r as { payload: Record<string | symbol, unknown> }).payload[
      Symbol("hidden")
    ] = "not-json"
    expect(decodeStoredRecord(r).kind).toBe("invalid")
  })

  test("decodeStoredRecord rejects extra array property", () => {
    const r = storedRecord([a])
    const arr: unknown[] = []
    ;(arr as unknown as Record<string, unknown>).extra = "not-json"
    ;(r as { payload: unknown }).payload = { arr }
    expect(decodeStoredRecord(r).kind).toBe("invalid")
  })

  test("isFullCoverage rejects descending matching arrays", () => {
    const b = baseMessage("9007199254740994")
    expect(isFullCoverage([...manifest([a, b])].reverse(), [b, a])).toBe(false)
  })
})
