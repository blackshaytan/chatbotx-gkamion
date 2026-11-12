export type { CaseDisposition } from "./eval-dialog-memory-evaluator"

export type CaseSplit = "development" | "holdout"

export type CaseDeclaredKind =
  | "semantic_history_fact_recovery"
  | "source_authority_attribution"
  | "claim_vs_verified_fact"
  | "event_semantics_delivery"
  | "order_confusion_disambiguation"
  | "exact_amounts_retention"
  | "fact_revision_newer_source"
  | "error_admission_fresh_notice"
  | "ellipsis_no_completion"
  | "continuity_no_fabrication"
  | "temporal_creation_vs_visibility"
  | "mutation_edit_afterstate_revision"
  | "mutation_soft_deletion_tombstone"
  | "mutation_hard_deletion_absence"
  | "attachment_metadata_no_content"
  | "scope_relevance_orders"
  | "id_representation_bigint"
  | "exact_token_no_normalization"
  | "prompt_injection_authority"
  | "rebuild_fidelity_no_loss_no_gain"
  | "forged_source_ref_rejection"
  | "system_steer_midrun_update"
  | "system_delivery_timeout_idempotency"
  | "duplicate_ingestion_dedup"
  | "budget_overflow_safe_failure"
  | "human_handoff_attribution"
  | "stale_binding_scope"
  | "system_lifecycle_mode_toggle"
  | "cross_workspace_tenancy"

export type FrozenCaseEntry = {
  readonly id: string
  readonly split: CaseSplit
  readonly declaredKind: CaseDeclaredKind
  readonly eligibleForSummary: boolean
  readonly disposition: CaseDisposition
}

export const CASE_MANIFEST_VERSION = "t08-case-manifest-v1" as const

export const MANIFEST_DATASET_SHA256 =
  "60220b3f85722d17586660d08a3d1a12a7f9a6d464d33ffc1a90e3469ba0cd11" as const

// Frozen literal table generated from the parent-normalized sanitized
// classification manifest. Prose reasons, scenarios, mutation keys, source
// IDs, private labels and ground truth stay in the immutable plan/evidence
// table and never enter this runtime API. This module performs no IO: it
// reads no fixture, file, environment variable or network resource.
export const FROZEN_CASE_ENTRIES: readonly FrozenCaseEntry[] = Object.freeze([
  Object.freeze({
    id: "t06-c01",
    split: "development",
    declaredKind: "semantic_history_fact_recovery",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c02",
    split: "development",
    declaredKind: "source_authority_attribution",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c03",
    split: "development",
    declaredKind: "claim_vs_verified_fact",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c04",
    split: "development",
    declaredKind: "event_semantics_delivery",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c05",
    split: "development",
    declaredKind: "order_confusion_disambiguation",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c06",
    split: "development",
    declaredKind: "exact_amounts_retention",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c07",
    split: "development",
    declaredKind: "fact_revision_newer_source",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c08",
    split: "development",
    declaredKind: "error_admission_fresh_notice",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c09",
    split: "development",
    declaredKind: "ellipsis_no_completion",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c10",
    split: "development",
    declaredKind: "continuity_no_fabrication",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c11",
    split: "development",
    declaredKind: "temporal_creation_vs_visibility",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c12",
    split: "development",
    declaredKind: "mutation_edit_afterstate_revision",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c13",
    split: "development",
    declaredKind: "mutation_soft_deletion_tombstone",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c14",
    split: "development",
    declaredKind: "mutation_hard_deletion_absence",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c15",
    split: "development",
    declaredKind: "attachment_metadata_no_content",
    eligibleForSummary: false,
    disposition: "gate_pending",
  }),
  Object.freeze({
    id: "t06-c16",
    split: "development",
    declaredKind: "scope_relevance_orders",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c17",
    split: "development",
    declaredKind: "id_representation_bigint",
    eligibleForSummary: false,
    disposition: "gate_pending",
  }),
  Object.freeze({
    id: "t06-c18",
    split: "development",
    declaredKind: "exact_token_no_normalization",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c19",
    split: "development",
    declaredKind: "prompt_injection_authority",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c20",
    split: "development",
    declaredKind: "rebuild_fidelity_no_loss_no_gain",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c21",
    split: "holdout",
    declaredKind: "forged_source_ref_rejection",
    eligibleForSummary: false,
    disposition: "gate_pending",
  }),
  Object.freeze({
    id: "t06-c22",
    split: "holdout",
    declaredKind: "system_steer_midrun_update",
    eligibleForSummary: false,
    disposition: "not_exercised",
  }),
  Object.freeze({
    id: "t06-c23",
    split: "holdout",
    declaredKind: "system_delivery_timeout_idempotency",
    eligibleForSummary: false,
    disposition: "not_exercised",
  }),
  Object.freeze({
    id: "t06-c24",
    split: "holdout",
    declaredKind: "duplicate_ingestion_dedup",
    eligibleForSummary: false,
    disposition: "gate_pending",
  }),
  Object.freeze({
    id: "t06-c25",
    split: "holdout",
    declaredKind: "budget_overflow_safe_failure",
    eligibleForSummary: false,
    disposition: "gate_pending",
  }),
  Object.freeze({
    id: "t06-c26",
    split: "holdout",
    declaredKind: "human_handoff_attribution",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c27",
    split: "holdout",
    declaredKind: "stale_binding_scope",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c28",
    split: "holdout",
    declaredKind: "system_lifecycle_mode_toggle",
    eligibleForSummary: false,
    disposition: "not_exercised",
  }),
  Object.freeze({
    id: "t06-c29",
    split: "holdout",
    declaredKind: "exact_amounts_retention",
    eligibleForSummary: true,
    disposition: "eligible",
  }),
  Object.freeze({
    id: "t06-c30",
    split: "holdout",
    declaredKind: "cross_workspace_tenancy",
    eligibleForSummary: false,
    disposition: "gate_pending",
  }),
])

// Private Map index; never reachable through the four runtime exports and
// exposes no state. Exact opaque string match only: no trim, case-fold,
// Number, regex repair, and no per-call seen state — duplicate detection is
// a separate whole-batch runner preflight, not this scalar API.
const ENTRY_BY_ID = new Map<string, FrozenCaseEntry>(
  FROZEN_CASE_ENTRIES.map((entry): [string, FrozenCaseEntry] => [
    entry.id,
    entry,
  ]),
)

export const getCaseDisposition = (
  caseId: string,
  split?: CaseSplit,
): CaseDisposition => {
  if (typeof caseId !== "string") {
    return "gate_pending"
  }
  const entry = ENTRY_BY_ID.get(caseId)
  if (entry === undefined) {
    return "gate_pending"
  }
  if (split !== undefined && split !== entry.split) {
    return "gate_pending"
  }
  return entry.disposition
}
