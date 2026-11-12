import { describe, expect, test } from "vitest"
import {
  FROZEN_CASE_ENTRIES,
  MANIFEST_DATASET_SHA256,
} from "../../../../scripts/lib/eval-dialog-memory-case-manifest"
import {
  type ManifestBatchFailureCode,
  type ManifestCaseIdentity,
  type ManifestPreflightInput,
  type ManifestPreflightResult,
  PREFLIGHT_VERSION,
  validateFrozenManifestBatch,
} from "../../../../scripts/lib/eval-dialog-memory-preflight"

type MutableIdentity = { id: string; split: string }
type MutableInput = {
  datasetSha256: string
  caseIdentities: MutableIdentity[]
}

const makeBaseIdentities = (): MutableIdentity[] =>
  FROZEN_CASE_ENTRIES.map(({ id, split }) => ({ id, split }))

const makeValidInput = (): MutableInput => ({
  datasetSha256: MANIFEST_DATASET_SHA256,
  caseIdentities: makeBaseIdentities(),
})

const expectValid = (result: ManifestPreflightResult): void => {
  expect(result).toEqual({
    kind: "valid",
    datasetSha256: MANIFEST_DATASET_SHA256,
    caseCount: 30,
  })
}

const expectInvalid = (
  result: ManifestPreflightResult,
  code: ManifestBatchFailureCode,
): void => {
  expect(result).toEqual({ kind: "invalid", code })
}

describe("eval-dialog-memory-preflight", () => {
  test("exports version constant and validator function", () => {
    expect(PREFLIGHT_VERSION).toBe("t08-case-preflight-v1")
    expect(typeof validateFrozenManifestBatch).toBe("function")
  })

  test("valid batch returns exact valid result", () => {
    expectValid(validateFrozenManifestBatch(makeValidInput()))
  })

  test("valid call is stable across repeated invocations", () => {
    const input = makeValidInput()
    expectValid(validateFrozenManifestBatch(input))
    expectValid(validateFrozenManifestBatch(input))
  })

  test.each([
    ["uppercase", MANIFEST_DATASET_SHA256.toUpperCase()],
    ["with leading/trailing whitespace", ` ${MANIFEST_DATASET_SHA256} `],
    ["empty string", ""],
  ])("bad digest (%s) returns dataset_hash_mismatch", (_label, digest) => {
    const input = makeValidInput()
    input.datasetSha256 = digest
    expectInvalid(validateFrozenManifestBatch(input), "dataset_hash_mismatch")
  })

  test.each([
    ["29 entries", 29],
    ["31 entries", 31],
  ])("wrong count (%s) returns identity_count_mismatch", (_label, count) => {
    const input = makeValidInput()
    input.caseIdentities = makeBaseIdentities().slice(0, count)
    if (count === 31) {
      input.caseIdentities.push({ id: "t06-extra", split: "development" })
    }
    expectInvalid(validateFrozenManifestBatch(input), "identity_count_mismatch")
  })

  test("duplicate identity returns duplicate_identity", () => {
    const input = makeValidInput()
    input.caseIdentities[29] = {
      id: input.caseIdentities[0].id,
      split: input.caseIdentities[0].split,
    }
    expectInvalid(validateFrozenManifestBatch(input), "duplicate_identity")
  })

  test("unknown identity returns identity_order_mismatch", () => {
    const input = makeValidInput()
    input.caseIdentities[5].id = "t06-c99"
    expectInvalid(validateFrozenManifestBatch(input), "identity_order_mismatch")
  })

  test("reordered identities return identity_order_mismatch", () => {
    const input = makeValidInput()
    const first = input.caseIdentities[0]
    const second = input.caseIdentities[1]
    input.caseIdentities[0] = second
    input.caseIdentities[1] = first
    expectInvalid(validateFrozenManifestBatch(input), "identity_order_mismatch")
  })

  test("wrong split returns identity_order_mismatch", () => {
    const input = makeValidInput()
    input.caseIdentities[0].split = "holdout"
    expectInvalid(validateFrozenManifestBatch(input), "identity_order_mismatch")
  })

  test("extra own key on identity returns invalid_input", () => {
    const input = makeValidInput()
    input.caseIdentities[0].extra = "surprise"
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
  })

  test("symbol own key on identity returns invalid_input", () => {
    const input = makeValidInput()
    ;(input.caseIdentities[0] as Record<symbol, unknown>)[Symbol("hidden")] = 1
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
  })

  test("accessor identity descriptor returns invalid_input with zero getter calls", () => {
    const input = makeValidInput()
    let calls = 0
    Object.defineProperty(input.caseIdentities[0], "id", {
      get() {
        calls += 1
        throw new Error("getter called")
      },
      enumerable: true,
      configurable: true,
    })
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
    expect(calls).toBe(0)
  })

  test("root proxy returns invalid_input", () => {
    const input = makeValidInput()
    const { proxy } = Proxy.revocable(input, {})
    expectInvalid(
      validateFrozenManifestBatch(proxy as unknown as ManifestPreflightInput),
      "invalid_input",
    )
  })

  test("array proxy returns invalid_input", () => {
    const input = makeValidInput()
    const { proxy } = Proxy.revocable(input.caseIdentities, {})
    input.caseIdentities = proxy as unknown as MutableIdentity[]
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
  })

  test("revoked root proxy returns invalid_input without throwing", () => {
    const input = makeValidInput()
    const { proxy, revoke } = Proxy.revocable(input, {})
    revoke()
    expect(() =>
      validateFrozenManifestBatch(proxy as unknown as ManifestPreflightInput),
    ).not.toThrow()
    expectInvalid(
      validateFrozenManifestBatch(proxy as unknown as ManifestPreflightInput),
      "invalid_input",
    )
  })

  test("revoked array proxy returns invalid_input without throwing", () => {
    const input = makeValidInput()
    const { proxy, revoke } = Proxy.revocable(input.caseIdentities, {})
    revoke()
    input.caseIdentities = proxy as unknown as MutableIdentity[]
    expect(() => validateFrozenManifestBatch(input)).not.toThrow()
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
  })

  test("array index accessor returns invalid_input with zero getter calls", () => {
    const input = makeValidInput()
    let calls = 0
    Object.defineProperty(input.caseIdentities, "0", {
      get() {
        calls += 1
        throw new Error("trap")
      },
      enumerable: true,
      configurable: true,
    })
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
    expect(calls).toBe(0)
  })

  test("sparse array returns invalid_input", () => {
    const input = makeValidInput()
    Reflect.deleteProperty(input.caseIdentities, "5")
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
  })

  test("extra array own property returns invalid_input", () => {
    const input = makeValidInput()
    ;(input.caseIdentities as unknown as Record<string, unknown>).foo = "bar"
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
  })

  test("extra in-range alias key accessor on array returns invalid_input with zero getter calls", () => {
    const input = makeValidInput()
    let calls = 0
    Object.defineProperty(input.caseIdentities, "01", {
      enumerable: true,
      configurable: true,
      get() {
        calls += 1
        throw new Error("EXTRA_ARRAY_GETTER")
      },
    })
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
    expect(calls).toBe(0)
  })

  test.each([
    ['"01" (leading zero)', "01"],
    ['" 1" (leading space)', " 1"],
    ['"+1" (explicit plus)', "+1"],
    ['"-0" (negative zero)', "-0"],
    ['"1.0" (decimal form)', "1.0"],
    ['"1e0" (exponent form)', "1e0"],
    ['"NaN"', "NaN"],
    ['"Infinity"', "Infinity"],
  ])("non-canonical in-range-coercing array key %s returns invalid_input", (_label, key) => {
    const input = makeValidInput()
    Object.defineProperty(input.caseIdentities, key, {
      enumerable: true,
      configurable: true,
      value: { id: "alias", split: "development" },
    })
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
  })

  // NOTE: defining enumerable canonical index "30" on a real Array
  // intrinsically grows length to 31, making the input structurally
  // identical to the pinned 31-entry extra-row case. Per contract
  // precedence (shape -> count before digest/row checks), the rejection
  // code is identity_count_mismatch; invalid_input is unattainable here
  // without contradicting that pinned precedent (identical states cannot
  // yield different codes). Out-of-range rejection of a canonical numeric
  // key that does NOT grow length is covered by the following case.
  test("out-of-range canonical array index key grows length and returns identity_count_mismatch", () => {
    const input = makeValidInput()
    expect(input.caseIdentities).toHaveLength(30)
    const defined = Reflect.defineProperty(input.caseIdentities, "30", {
      enumerable: true,
      configurable: true,
      value: { id: "t08-out-of-range", split: "development" },
    })
    expect(defined).toBe(true)
    expect(input.caseIdentities).toHaveLength(31)
    expectInvalid(
      validateFrozenManifestBatch(input as ManifestPreflightInput),
      "identity_count_mismatch",
    )
  })

  test("out-of-range canonical numeric key that does not grow length returns invalid_input", () => {
    const input = makeValidInput()
    expect(input.caseIdentities).toHaveLength(30)
    // String(2 ** 32) is a canonical numeric string but not an array
    // index, so defining it leaves length at 30 while adding an own key
    // whose integer value is out of range for the 30-row array.
    const outOfRangeKey = String(2 ** 32)
    const defined = Reflect.defineProperty(
      input.caseIdentities,
      outOfRangeKey,
      {
        enumerable: true,
        configurable: true,
        value: { id: "t08-out-of-range", split: "development" },
      },
    )
    expect(defined).toBe(true)
    expect(input.caseIdentities).toHaveLength(30)
    expectInvalid(
      validateFrozenManifestBatch(input as ManifestPreflightInput),
      "invalid_input",
    )
  })

  test("non-object root returns invalid_input", () => {
    expectInvalid(
      validateFrozenManifestBatch("bad" as unknown as ManifestPreflightInput),
      "invalid_input",
    )
    expectInvalid(
      validateFrozenManifestBatch(42 as unknown as ManifestPreflightInput),
      "invalid_input",
    )
    expectInvalid(
      validateFrozenManifestBatch(null as unknown as ManifestPreflightInput),
      "invalid_input",
    )
  })

  test("non-string identity field returns invalid_input", () => {
    const input = makeValidInput()
    input.caseIdentities[0].id = 123 as unknown as string
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
  })

  test("root symbol own key returns invalid_input", () => {
    const input = makeValidInput()
    ;(input as unknown as Record<symbol, unknown>)[Symbol("hidden")] = 1
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
  })

  test("root accessor returns invalid_input with zero getter calls", () => {
    const input = makeValidInput()
    let calls = 0
    Object.defineProperty(input, "caseIdentities", {
      get() {
        calls += 1
        throw new Error("getter")
      },
      enumerable: true,
      configurable: true,
    })
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
    expect(calls).toBe(0)
  })

  test("root extra own key returns invalid_input", () => {
    const input = makeValidInput()
    ;(input as unknown as Record<string, unknown>).extra = "surprise"
    expectInvalid(validateFrozenManifestBatch(input), "invalid_input")
  })

  test("null-prototype root and entries are accepted", () => {
    const identities = makeBaseIdentities().map((entry) =>
      Object.assign(Object.create(null), entry),
    )
    const root = Object.assign(Object.create(null), {
      datasetSha256: MANIFEST_DATASET_SHA256,
      caseIdentities: identities,
    })
    expectValid(
      validateFrozenManifestBatch(root as unknown as ManifestPreflightInput),
    )
  })

  test("frozen input is accepted and not mutated", () => {
    const input = makeValidInput()
    Object.freeze(input)
    for (const entry of input.caseIdentities) {
      Object.freeze(entry)
    }
    const before = JSON.parse(JSON.stringify(input))
    expectValid(validateFrozenManifestBatch(input as ManifestPreflightInput))
    expect(input).toEqual(before)
    expect(Object.isFrozen(input)).toBe(true)
  })

  test("valid call does not mutate or freeze caller input", () => {
    const input = makeValidInput()
    const before = JSON.parse(JSON.stringify(input))
    expectValid(validateFrozenManifestBatch(input))
    expect(input).toEqual(before)
    expect(Object.isFrozen(input)).toBe(false)
  })

  test("invalid result contains no caller data", () => {
    const input = makeValidInput()
    input.datasetSha256 = "BAD"
    const result = validateFrozenManifestBatch(input)
    expectInvalid(result, "dataset_hash_mismatch")
    expect(Object.keys(result)).toEqual(["kind", "code"])
  })

  describe("failure precedence", () => {
    test("bad root beats bad digest", () => {
      const badRoot = [] as unknown as ManifestPreflightInput
      badRoot.datasetSha256 = "BAD"
      badRoot.caseIdentities =
        makeBaseIdentities() as unknown as readonly ManifestCaseIdentity[]
      expectInvalid(validateFrozenManifestBatch(badRoot), "invalid_input")
    })

    test("wrong count beats bad digest", () => {
      const input = makeValidInput()
      input.caseIdentities = makeBaseIdentities().slice(0, 29)
      input.datasetSha256 = "BAD"
      expectInvalid(
        validateFrozenManifestBatch(input),
        "identity_count_mismatch",
      )
    })

    test("duplicate beats reordered", () => {
      const input = makeValidInput()
      input.caseIdentities[29] = {
        id: input.caseIdentities[0].id,
        split: input.caseIdentities[0].split,
      }
      const tmp = input.caseIdentities[2]
      input.caseIdentities[2] = input.caseIdentities[3]
      input.caseIdentities[3] = tmp
      expectInvalid(validateFrozenManifestBatch(input), "duplicate_identity")
    })

    test("proper count with bad digest returns dataset_hash_mismatch", () => {
      const input = makeValidInput()
      input.datasetSha256 = "BAD"
      expectInvalid(validateFrozenManifestBatch(input), "dataset_hash_mismatch")
    })
  })
})
