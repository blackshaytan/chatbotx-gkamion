import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { isProxy } from "node:util/types"
import {
  type AdaptFailCode,
  adaptDialogMemoryCase,
} from "./eval-dialog-memory-fixture-adapter"
import {
  type ManifestCaseIdentity,
  type ManifestPreflightResult,
  validateFrozenManifestBatch,
} from "./eval-dialog-memory-preflight"

export const DATASET_BYTES_VERSION = "t08-dataset-bytes-v1" as const

export type DatasetBytesFailureCode =
  | "invalid_bytes"
  | "invalid_utf8"
  | "invalid_json"
  | "dataset_schema_mismatch"
  | "case_decode_rejected"
  | "invalid_path"
  | "dataset_unreadable"

export type DatasetBytesInvalid = {
  readonly kind: "invalid"
  readonly code: DatasetBytesFailureCode
  readonly adapterReason?: AdaptFailCode
}

export type DatasetBytesChecked = {
  readonly kind: "checked"
  readonly datasetSha256: string
  readonly caseIdentities: readonly ManifestCaseIdentity[]
  readonly preflight: ManifestPreflightResult
}

export type DatasetBytesResult = DatasetBytesInvalid | DatasetBytesChecked

const ENVELOPE_KEYS = [
  "schemaVersion",
  "synthetic",
  "notes",
  "humanApproved",
  "dataStatus",
  "evaluationTarget",
  "sourceSelectionPolicy",
  "currentMessageIdsMeaning",
  "cases",
] as const

const invalid = (code: DatasetBytesFailureCode): DatasetBytesInvalid => ({
  kind: "invalid",
  code,
})

const safeIsProxy = (value: unknown): boolean => {
  try {
    return isProxy(value)
  } catch {
    return true
  }
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

const validateEnvelope = (
  value: unknown,
): { readonly kind: "ok"; readonly cases: unknown[] } | null => {
  if (!isPlainObject(value)) {
    return null
  }

  const keys = Object.keys(value)
  if (keys.length !== ENVELOPE_KEYS.length) {
    return null
  }
  for (const key of ENVELOPE_KEYS) {
    if (!keys.includes(key)) {
      return null
    }
  }

  const envelope = value as Record<string, unknown>
  if (
    envelope.schemaVersion !== 2 ||
    envelope.synthetic !== true ||
    envelope.humanApproved !== false ||
    envelope.dataStatus !== "machine_candidate" ||
    envelope.evaluationTarget !== "memory_on_full_source" ||
    envelope.sourceSelectionPolicy !==
      "all_after_state_messages_except_deleted" ||
    envelope.currentMessageIdsMeaning !== "request_window_only" ||
    typeof envelope.notes !== "string" ||
    !Array.isArray(envelope.cases)
  ) {
    return null
  }

  return { kind: "ok", cases: envelope.cases as unknown[] }
}

export const loadDialogMemoryDatasetBytes = (
  bytes: Uint8Array,
): DatasetBytesResult => {
  if (safeIsProxy(bytes)) {
    return invalid("invalid_bytes")
  }

  if (!(bytes instanceof Uint8Array)) {
    return invalid("invalid_bytes")
  }

  let digest: string
  try {
    digest = createHash("sha256").update(bytes).digest("hex")
  } catch {
    return invalid("invalid_bytes")
  }

  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return invalid("invalid_utf8")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return invalid("invalid_json")
  }

  const envelope = validateEnvelope(parsed)
  if (envelope === null) {
    return invalid("dataset_schema_mismatch")
  }

  const caseIdentities: ManifestCaseIdentity[] = []

  for (const caseValue of envelope.cases) {
    if (!isPlainObject(caseValue)) {
      return invalid("dataset_schema_mismatch")
    }

    let caseJson: string
    try {
      caseJson = JSON.stringify(caseValue)
    } catch {
      return invalid("dataset_schema_mismatch")
    }

    const adapted = adaptDialogMemoryCase(
      {
        caseJson,
        scope: {
          workspaceId: "1",
          conversationId: "2",
          expectedContactId: "4",
        },
        deadlineAtMs: 1000,
      },
      { nowMs: () => 0 },
    )

    if (adapted.kind === "reject") {
      return {
        kind: "invalid",
        code: "case_decode_rejected",
        adapterReason: adapted.reason,
      }
    }

    const caseRecord = caseValue as Record<string, unknown>
    caseIdentities.push({
      id: caseRecord.id as string,
      split: caseRecord.split as "development" | "holdout",
    })
  }

  const preflight = validateFrozenManifestBatch({
    datasetSha256: digest,
    caseIdentities,
  })

  return {
    kind: "checked",
    datasetSha256: digest,
    caseIdentities,
    preflight,
  }
}

export const loadDialogMemoryDatasetFile = (
  filePath: string,
): DatasetBytesResult => {
  if (safeIsProxy(filePath)) {
    return invalid("invalid_path")
  }

  if (typeof filePath !== "string") {
    return invalid("invalid_path")
  }

  let fileBytes: Buffer
  try {
    fileBytes = readFileSync(filePath)
  } catch {
    return invalid("dataset_unreadable")
  }

  return loadDialogMemoryDatasetBytes(fileBytes)
}
