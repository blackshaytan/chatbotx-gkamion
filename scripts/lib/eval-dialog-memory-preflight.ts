import { isProxy } from "node:util/types"
import {
  FROZEN_CASE_ENTRIES,
  MANIFEST_DATASET_SHA256,
} from "./eval-dialog-memory-case-manifest"

export const PREFLIGHT_VERSION = "t08-case-preflight-v1" as const

export type ManifestCaseIdentity = {
  readonly id: string
  readonly split: "development" | "holdout"
}

export type ManifestPreflightInput = {
  readonly datasetSha256: string
  readonly caseIdentities: readonly ManifestCaseIdentity[]
}

export type ManifestBatchFailureCode =
  | "invalid_input"
  | "dataset_hash_mismatch"
  | "identity_count_mismatch"
  | "identity_order_mismatch"
  | "duplicate_identity"

export type ManifestPreflightResult =
  | {
      readonly kind: "valid"
      readonly datasetSha256: typeof MANIFEST_DATASET_SHA256
      readonly caseCount: 30
    }
  | {
      readonly kind: "invalid"
      readonly code: ManifestBatchFailureCode
    }

const EXPECTED_IDENTITIES: readonly ManifestCaseIdentity[] =
  FROZEN_CASE_ENTRIES.map(
    ({ id, split }): ManifestCaseIdentity => ({ id, split }),
  )

const invalid = (code: ManifestBatchFailureCode): ManifestPreflightResult => ({
  kind: "invalid",
  code,
})

const safeIsProxy = (value: unknown): boolean => {
  // Treat any trap/exception from a revoked or hostile Proxy as a proxy
  // rejection so the validator never throws and performs zero observable
  // operations on suspicious values.
  try {
    return isProxy(value)
  } catch {
    return true
  }
}

const isDataDescriptor = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is { value: unknown; enumerable: boolean } => {
  if (descriptor === undefined) {
    return false
  }
  return "value" in descriptor && descriptor.enumerable === true
}

const isPlainObject = (value: unknown): boolean => {
  if (value === null || typeof value !== "object") {
    return false
  }
  if (safeIsProxy(value)) {
    return false
  }
  if (Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const CANONICAL_ARRAY_INDEX_KEY = /^(?:0|[1-9][0-9]*)$/

/**
 * Accept only canonical array index property names: the literal key must be
 * exactly `String(n)` for an integer n with 0 <= n < length. Any key that
 * merely coerces to an in-range number ("01", " 1", "+1", "-0", "1.0",
 * "1e0", "NaN", "Infinity") is rejected, because such extra own
 * enumerable properties are not canonical array indices and violate the
 * expected-shape contract. Keys arrive from Object.getOwnPropertyNames;
 * no accessor is ever read here.
 */
const isCanonicalArrayIndexKey = (key: string, length: number): boolean => {
  if (!CANONICAL_ARRAY_INDEX_KEY.test(key)) {
    return false
  }
  const index = Number(key)
  return Number.isInteger(index) && index < length
}

const isArrayIndex = (key: string, length: number): boolean => {
  if (key === "length") {
    return true
  }
  return isCanonicalArrayIndexKey(key, length)
}

/**
 * Pure whole-batch identity/dataset-integrity preflight for the frozen T08
 * dialog-memory case manifest.
 *
 * This function checks the caller-supplied SHA-256 digest and the complete
 * ordered list of case identities against the frozen manifest constants. It
 * does NOT read fixture bytes or recompute the digest; a future runner must
 * compute the digest from the exact decoded file bytes before calling this
 * validator.
 */
export const validateFrozenManifestBatch = (
  input: ManifestPreflightInput,
): ManifestPreflightResult => {
  const root = input as unknown

  if (safeIsProxy(root)) {
    return invalid("invalid_input")
  }

  if (!isPlainObject(root)) {
    return invalid("invalid_input")
  }

  const rootKeys = Object.getOwnPropertyNames(root)
  if (rootKeys.length !== 2) {
    return invalid("invalid_input")
  }
  if (
    !(rootKeys.includes("datasetSha256") && rootKeys.includes("caseIdentities"))
  ) {
    return invalid("invalid_input")
  }
  if (Object.getOwnPropertySymbols(root).length !== 0) {
    return invalid("invalid_input")
  }

  const datasetSha256Descriptor = Object.getOwnPropertyDescriptor(
    root,
    "datasetSha256",
  )
  const caseIdentitiesDescriptor = Object.getOwnPropertyDescriptor(
    root,
    "caseIdentities",
  )

  if (!isDataDescriptor(datasetSha256Descriptor)) {
    return invalid("invalid_input")
  }
  if (!isDataDescriptor(caseIdentitiesDescriptor)) {
    return invalid("invalid_input")
  }

  const datasetSha256 = datasetSha256Descriptor.value
  if (typeof datasetSha256 !== "string") {
    return invalid("invalid_input")
  }

  const caseIdentities = caseIdentitiesDescriptor.value

  if (safeIsProxy(caseIdentities)) {
    return invalid("invalid_input")
  }
  if (!Array.isArray(caseIdentities)) {
    return invalid("invalid_input")
  }
  if (Object.getPrototypeOf(caseIdentities) !== Array.prototype) {
    return invalid("invalid_input")
  }

  const length = caseIdentities.length
  if (typeof length !== "number" || !Number.isInteger(length)) {
    return invalid("invalid_input")
  }

  if (Object.getOwnPropertySymbols(caseIdentities).length !== 0) {
    return invalid("invalid_input")
  }

  const arrayKeys = Object.getOwnPropertyNames(caseIdentities)
  for (const key of arrayKeys) {
    if (!isArrayIndex(key, length)) {
      return invalid("invalid_input")
    }
  }

  for (let i = 0; i < length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(
      caseIdentities,
      String(i),
    )
    if (!isDataDescriptor(descriptor)) {
      return invalid("invalid_input")
    }
  }

  if (length !== 30) {
    return invalid("identity_count_mismatch")
  }

  if (datasetSha256 !== MANIFEST_DATASET_SHA256) {
    return invalid("dataset_hash_mismatch")
  }

  for (let i = 0; i < 30; i += 1) {
    const entry = caseIdentities[i]

    if (safeIsProxy(entry)) {
      return invalid("invalid_input")
    }
    if (!isPlainObject(entry)) {
      return invalid("invalid_input")
    }

    const entryKeys = Object.getOwnPropertyNames(entry)
    if (
      entryKeys.length !== 2 ||
      !entryKeys.includes("id") ||
      !entryKeys.includes("split")
    ) {
      return invalid("invalid_input")
    }
    if (Object.getOwnPropertySymbols(entry).length !== 0) {
      return invalid("invalid_input")
    }

    const idDescriptor = Object.getOwnPropertyDescriptor(entry, "id")
    const splitDescriptor = Object.getOwnPropertyDescriptor(entry, "split")

    if (
      !isDataDescriptor(idDescriptor) ||
      typeof idDescriptor.value !== "string"
    ) {
      return invalid("invalid_input")
    }
    if (
      !isDataDescriptor(splitDescriptor) ||
      typeof splitDescriptor.value !== "string"
    ) {
      return invalid("invalid_input")
    }
  }

  const seenIds = new Set<string>()
  for (let i = 0; i < 30; i += 1) {
    const entry = caseIdentities[i] as Record<string, string>
    if (seenIds.has(entry.id)) {
      return invalid("duplicate_identity")
    }
    seenIds.add(entry.id)
  }

  for (let i = 0; i < 30; i += 1) {
    const entry = caseIdentities[i] as Record<string, string>
    const expected = EXPECTED_IDENTITIES[i]
    if (entry.id !== expected.id || entry.split !== expected.split) {
      return invalid("identity_order_mismatch")
    }
  }

  return {
    kind: "valid",
    datasetSha256: MANIFEST_DATASET_SHA256,
    caseCount: 30,
  }
}
