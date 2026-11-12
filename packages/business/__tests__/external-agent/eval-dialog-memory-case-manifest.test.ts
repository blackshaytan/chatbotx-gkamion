import { describe, expect, test } from "vitest"
import {
  CASE_MANIFEST_VERSION,
  type CaseDeclaredKind,
  type CaseDisposition,
  type CaseSplit,
  FROZEN_CASE_ENTRIES,
  type FrozenCaseEntry,
  getCaseDisposition,
  MANIFEST_DATASET_SHA256,
} from "../../../../scripts/lib/eval-dialog-memory-case-manifest"

// Explicit fixture: sanitized manifest columns id/split/declaredKind/
// eligibleForSummary/disposition copied as literals only. No source, gold,
// holdout labels, conversation content or provider material lives here.
const EXPECTED_ENTRIES: readonly FrozenCaseEntry[] = [
  {
    id: "t06-c01",
    split: "development",
    declaredKind: "semantic_history_fact_recovery",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c02",
    split: "development",
    declaredKind: "source_authority_attribution",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c03",
    split: "development",
    declaredKind: "claim_vs_verified_fact",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c04",
    split: "development",
    declaredKind: "event_semantics_delivery",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c05",
    split: "development",
    declaredKind: "order_confusion_disambiguation",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c06",
    split: "development",
    declaredKind: "exact_amounts_retention",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c07",
    split: "development",
    declaredKind: "fact_revision_newer_source",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c08",
    split: "development",
    declaredKind: "error_admission_fresh_notice",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c09",
    split: "development",
    declaredKind: "ellipsis_no_completion",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c10",
    split: "development",
    declaredKind: "continuity_no_fabrication",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c11",
    split: "development",
    declaredKind: "temporal_creation_vs_visibility",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c12",
    split: "development",
    declaredKind: "mutation_edit_afterstate_revision",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c13",
    split: "development",
    declaredKind: "mutation_soft_deletion_tombstone",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c14",
    split: "development",
    declaredKind: "mutation_hard_deletion_absence",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c15",
    split: "development",
    declaredKind: "attachment_metadata_no_content",
    eligibleForSummary: false,
    disposition: "gate_pending",
  },
  {
    id: "t06-c16",
    split: "development",
    declaredKind: "scope_relevance_orders",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c17",
    split: "development",
    declaredKind: "id_representation_bigint",
    eligibleForSummary: false,
    disposition: "gate_pending",
  },
  {
    id: "t06-c18",
    split: "development",
    declaredKind: "exact_token_no_normalization",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c19",
    split: "development",
    declaredKind: "prompt_injection_authority",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c20",
    split: "development",
    declaredKind: "rebuild_fidelity_no_loss_no_gain",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c21",
    split: "holdout",
    declaredKind: "forged_source_ref_rejection",
    eligibleForSummary: false,
    disposition: "gate_pending",
  },
  {
    id: "t06-c22",
    split: "holdout",
    declaredKind: "system_steer_midrun_update",
    eligibleForSummary: false,
    disposition: "not_exercised",
  },
  {
    id: "t06-c23",
    split: "holdout",
    declaredKind: "system_delivery_timeout_idempotency",
    eligibleForSummary: false,
    disposition: "not_exercised",
  },
  {
    id: "t06-c24",
    split: "holdout",
    declaredKind: "duplicate_ingestion_dedup",
    eligibleForSummary: false,
    disposition: "gate_pending",
  },
  {
    id: "t06-c25",
    split: "holdout",
    declaredKind: "budget_overflow_safe_failure",
    eligibleForSummary: false,
    disposition: "gate_pending",
  },
  {
    id: "t06-c26",
    split: "holdout",
    declaredKind: "human_handoff_attribution",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c27",
    split: "holdout",
    declaredKind: "stale_binding_scope",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c28",
    split: "holdout",
    declaredKind: "system_lifecycle_mode_toggle",
    eligibleForSummary: false,
    disposition: "not_exercised",
  },
  {
    id: "t06-c29",
    split: "holdout",
    declaredKind: "exact_amounts_retention",
    eligibleForSummary: true,
    disposition: "eligible",
  },
  {
    id: "t06-c30",
    split: "holdout",
    declaredKind: "cross_workspace_tenancy",
    eligibleForSummary: false,
    disposition: "gate_pending",
  },
]

const EXPECTED_IDS: readonly string[] = Array.from(
  { length: 30 },
  (_, index) => `t06-c${String(index + 1).padStart(2, "0")}`,
)

const PENDING_IDS: readonly string[] = [
  "t06-c15",
  "t06-c17",
  "t06-c21",
  "t06-c24",
  "t06-c25",
  "t06-c30",
]

const DECLARED_KINDS: readonly CaseDeclaredKind[] = FROZEN_CASE_ENTRIES.map(
  (entry) => entry.declaredKind,
)

const countByDisposition = (target: CaseDisposition): number =>
  FROZEN_CASE_ENTRIES.filter((entry) => entry.disposition === target).length

const oppositeSplit = (split: CaseSplit): CaseSplit =>
  split === "development" ? "holdout" : "development"

// Strict-mode mutation of a frozen target throws TypeError; silent failure
// is equally acceptable for the assertions below, so swallow both.
const attemptMutation = (mutate: () => void): void => {
  try {
    mutate()
  } catch {
    // frozen target refused the write
  }
}

const hostileObject = (): object => ({
  toString() {
    throw new Error("STRING_COERCION_ATTEMPTED")
  },
  valueOf() {
    throw new Error("NUMBER_COERCION_ATTEMPTED")
  },
})

describe("manifest constants", () => {
  test("version and dataset digest are exact literal provenance pins", () => {
    expect(CASE_MANIFEST_VERSION).toBe("t08-case-manifest-v1")
    expect(MANIFEST_DATASET_SHA256).toBe(
      "60220b3f85722d17586660d08a3d1a12a7f9a6d464d33ffc1a90e3469ba0cd11",
    )
    expect(typeof CASE_MANIFEST_VERSION).toBe("string")
    expect(typeof MANIFEST_DATASET_SHA256).toBe("string")
    expect(MANIFEST_DATASET_SHA256).toHaveLength(64)
    expect(
      MANIFEST_DATASET_SHA256.split("").every((char) =>
        "0123456789abcdef".includes(char),
      ),
    ).toBe(true)
  })

  test("runtime scalar exports carry no path or network material", () => {
    for (const value of [CASE_MANIFEST_VERSION, MANIFEST_DATASET_SHA256]) {
      expect(value.includes("/")).toBe(false)
      expect(value.includes("\\")).toBe(false)
      expect(value.includes("://")).toBe(false)
    }
    const concatenated = FROZEN_CASE_ENTRIES.map(
      (entry) => `${entry.id}${entry.split}${entry.declaredKind}`,
    ).join("")
    expect(concatenated.includes("/")).toBe(false)
    expect(concatenated.includes("://")).toBe(false)
  })
})

describe("runtime export surface", () => {
  test("module exposes exactly four runtime exports and no extras", async () => {
    const mod = await import(
      "../../../../scripts/lib/eval-dialog-memory-case-manifest"
    )
    expect(Object.keys(mod).sort()).toEqual(
      [
        "CASE_MANIFEST_VERSION",
        "FROZEN_CASE_ENTRIES",
        "MANIFEST_DATASET_SHA256",
        "getCaseDisposition",
      ].sort(),
    )
  })

  test("exported runtime values have their expected shapes", () => {
    expect(typeof getCaseDisposition).toBe("function")
    expect(Array.isArray(FROZEN_CASE_ENTRIES)).toBe(true)
    expect(typeof CASE_MANIFEST_VERSION).toBe("string")
    expect(typeof MANIFEST_DATASET_SHA256).toBe("string")
  })
})

describe("frozen static entries", () => {
  test("entries exactly mirror the sanitized manifest in supplied order", () => {
    expect(FROZEN_CASE_ENTRIES).toEqual(EXPECTED_ENTRIES)
    expect(FROZEN_CASE_ENTRIES).toHaveLength(30)
  })

  test("all 30 ids are exact unique and in manifest order", () => {
    expect(FROZEN_CASE_ENTRIES.map((entry) => entry.id)).toEqual(EXPECTED_IDS)
    expect(new Set(FROZEN_CASE_ENTRIES.map((entry) => entry.id)).size).toBe(30)
  })

  test("split disposition counts and kinds are exact", () => {
    expect(
      FROZEN_CASE_ENTRIES.filter((entry) => entry.split === "development"),
    ).toHaveLength(20)
    expect(
      FROZEN_CASE_ENTRIES.filter((entry) => entry.split === "holdout"),
    ).toHaveLength(10)
    expect(countByDisposition("eligible")).toBe(21)
    expect(countByDisposition("not_exercised")).toBe(3)
    expect(countByDisposition("gate_pending")).toBe(6)
    expect(
      FROZEN_CASE_ENTRIES.filter((entry) => entry.eligibleForSummary),
    ).toHaveLength(21)
    expect(DECLARED_KINDS).toHaveLength(30)
    expect(new Set(DECLARED_KINDS).size).toBe(29)
  })

  test("the six uncertain ids stay gate_pending in the manifest", () => {
    expect(
      FROZEN_CASE_ENTRIES.filter(
        (entry) => entry.disposition === "gate_pending",
      ).map((entry) => entry.id),
    ).toEqual(PENDING_IDS)
    for (const entry of FROZEN_CASE_ENTRIES) {
      if (PENDING_IDS.includes(entry.id)) {
        expect(entry.disposition).toBe("gate_pending")
        expect(entry.eligibleForSummary).toBe(false)
      }
    }
  })

  test("each entry exposes exactly the five manifest fields", () => {
    const expectedKeys = [
      "declaredKind",
      "disposition",
      "eligibleForSummary",
      "id",
      "split",
    ]
    for (const entry of FROZEN_CASE_ENTRIES) {
      expect(Object.keys(entry).sort()).toEqual(expectedKeys)
    }
    const raw = JSON.stringify(FROZEN_CASE_ENTRIES)
    for (const forbidden of [
      "reason",
      "scenario",
      "mutationKeys",
      "source",
      "gold",
      "humanApproved",
      "currentWindowRefs",
    ]) {
      expect(raw.includes(`"${forbidden}"`)).toBe(false)
    }
  })

  test("array snapshot and every record are deeply immutable", () => {
    expect(Object.isFrozen(FROZEN_CASE_ENTRIES)).toBe(true)
    for (const entry of FROZEN_CASE_ENTRIES) {
      expect(Object.isFrozen(entry)).toBe(true)
    }

    // Deliberately mutable adversarial views over the production readonly
    // surface; every write must fail or land nowhere.
    const rows = FROZEN_CASE_ENTRIES as unknown as {
      push: (row: unknown) => void
      splice: (start: number, deleteCount: number) => void
      [index: number]: unknown
    }
    attemptMutation(() =>
      rows.push({
        id: "t06-c31",
        split: "holdout",
        declaredKind: "cross_workspace_tenancy",
        eligibleForSummary: false,
        disposition: "gate_pending",
      }),
    )
    attemptMutation(() => {
      rows[0] = { id: "tampered" }
    })
    attemptMutation(() => rows.splice(0, 1))

    const first = FROZEN_CASE_ENTRIES[0] as unknown as {
      id: string
      disposition: string
      eligibleForSummary: boolean
    }
    attemptMutation(() => {
      first.id = "tampered"
      first.disposition = "gate_pending"
      first.eligibleForSummary = false
    })

    expect(FROZEN_CASE_ENTRIES).toHaveLength(30)
    expect(FROZEN_CASE_ENTRIES[0].id).toBe("t06-c01")
    expect(FROZEN_CASE_ENTRIES[0].disposition).toBe("eligible")
    expect(FROZEN_CASE_ENTRIES[0].eligibleForSummary).toBe(true)
    expect(FROZEN_CASE_ENTRIES).toEqual(EXPECTED_ENTRIES)
  })
})

describe("getCaseDisposition exact opaque lookup", () => {
  test("omitted split returns entry disposition for all 30 twice", () => {
    for (const entry of FROZEN_CASE_ENTRIES) {
      expect(getCaseDisposition(entry.id)).toBe(entry.disposition)
      expect(getCaseDisposition(entry.id)).toBe(entry.disposition)
    }
  })

  test("matching split returns entry disposition for all 30 twice", () => {
    for (const entry of FROZEN_CASE_ENTRIES) {
      expect(getCaseDisposition(entry.id, entry.split)).toBe(entry.disposition)
      expect(getCaseDisposition(entry.id, entry.split)).toBe(entry.disposition)
    }
  })

  test("all six pending ids stay gate_pending under every split argument", () => {
    for (const id of PENDING_IDS) {
      expect(getCaseDisposition(id)).toBe("gate_pending")
      expect(getCaseDisposition(id, "development")).toBe("gate_pending")
      expect(getCaseDisposition(id, "holdout")).toBe("gate_pending")
    }
  })

  test("mismatched split is always gate_pending for every known id", () => {
    for (const entry of FROZEN_CASE_ENTRIES) {
      expect(getCaseDisposition(entry.id, oppositeSplit(entry.split))).toBe(
        "gate_pending",
      )
    }
  })

  test("unknown ids are always gate_pending with any split", () => {
    const unknownIds = [
      "",
      "t06-c0",
      "t06-c00",
      "t06-c001",
      "t06-c31",
      "t06-c99",
      "c01",
      "01",
      "t07-c01",
      "unknown",
    ]
    for (const id of unknownIds) {
      expect(getCaseDisposition(id)).toBe("gate_pending")
      expect(getCaseDisposition(id, "development")).toBe("gate_pending")
      expect(getCaseDisposition(id, "holdout")).toBe("gate_pending")
    }
  })

  test("no trim case-fold whitespace or numeric repair on ids", () => {
    const nearMisses = [
      " t06-c01",
      "t06-c01 ",
      "\tt06-c01",
      "t06-c01\n",
      "T06-C01",
      "t06-C01",
      "t06-c01 ",
      "06-c01",
      "t6-c01",
    ]
    for (const id of nearMisses) {
      expect(getCaseDisposition(id)).toBe("gate_pending")
      expect(getCaseDisposition(id, "development")).toBe("gate_pending")
    }
    const oddSplits = ["Development", "dev", "", "holdout ", "development\n"]
    for (const split of oddSplits) {
      expect(getCaseDisposition("t06-c01", split as CaseSplit)).toBe(
        "gate_pending",
      )
    }
  })

  test("adversarial non-string ids never coerce and never throw", () => {
    const hostile: readonly unknown[] = [
      null,
      undefined,
      0,
      42,
      Number.NaN,
      true,
      ["t06-c01"],
      { id: "t06-c01" },
      hostileObject(),
      Symbol("t06-c01"),
      () => "t06-c01",
    ]
    for (const value of hostile) {
      expect(getCaseDisposition(value as unknown as string)).toBe(
        "gate_pending",
      )
      expect(
        getCaseDisposition(value as unknown as string, "development"),
      ).toBe("gate_pending")
    }
  })

  test("adversarial split values never coerce and never throw", () => {
    const hostileSplits: readonly unknown[] = [
      null,
      1,
      true,
      ["holdout"],
      { split: "development" },
      hostileObject(),
      Symbol("development"),
    ]
    for (const value of hostileSplits) {
      expect(getCaseDisposition("t06-c01", value as unknown as CaseSplit)).toBe(
        "gate_pending",
      )
      expect(getCaseDisposition("t06-c31", value as unknown as CaseSplit)).toBe(
        "gate_pending",
      )
    }
    // Undefined split argument is genuinely omitted, not coerced.
    expect(getCaseDisposition("t06-c01", undefined)).toBe("eligible")
  })

  test("repeated interleaved calls stay deterministic and mark nothing seen", () => {
    const first = getCaseDisposition("t06-c16", "development")
    for (let round = 0; round < 5; round++) {
      expect(getCaseDisposition("t06-c16", "holdout")).toBe("gate_pending")
      expect(getCaseDisposition("t06-c99")).toBe("gate_pending")
      expect(getCaseDisposition("t06-c16", "development")).toBe(first)
      expect(getCaseDisposition("t06-c16")).toBe(first)
      expect(getCaseDisposition("t06-c26", "holdout")).toBe("eligible")
    }
    // A lookup call is not a per-id seen marker: known ids keep resolving
    // to their frozen dispositions forever; duplicate detection belongs to
    // a separate whole-batch runner preflight, not this scalar API.
    expect(getCaseDisposition("t06-c16")).toBe("eligible")
    expect(getCaseDisposition("t06-c22")).toBe("not_exercised")
  })

  test("lookups never mutate entries or disturb other cases", () => {
    const before = JSON.stringify(FROZEN_CASE_ENTRIES)
    for (const entry of FROZEN_CASE_ENTRIES) {
      getCaseDisposition(entry.id)
      getCaseDisposition(entry.id, entry.split)
      getCaseDisposition(entry.id, oppositeSplit(entry.split))
      getCaseDisposition("t06-c99", entry.split)
      getCaseDisposition(42 as unknown as string, entry.split)
      getCaseDisposition(hostileObject() as unknown as string)
    }
    expect(JSON.stringify(FROZEN_CASE_ENTRIES)).toBe(before)
    expect(FROZEN_CASE_ENTRIES).toEqual(EXPECTED_ENTRIES)
    expect(getCaseDisposition("t06-c01")).toBe("eligible")
    expect(getCaseDisposition("t06-c30")).toBe("gate_pending")
  })
})
