import { z } from "zod"
import type { MessageRef } from "./memory-coverage"
import { compareRefsAsc } from "./memory-coverage"

export const MEMORY_PAYLOAD_VERSION = 1 as const

export const VALIDATOR_VERSION = "T07-A" as const

export const VALIDATION_LIMITS = {
  maxCandidateUtf8Bytes: 64 * 1024,
  maxNodeDepth: 32,
  maxNodesTotal: 10_000,
  maxFacts: 64,
  maxQuotesPerFact: 4,
  maxQuoteUtf16Chars: 1000,
  maxNarrativeUtf16Chars: 2000,
  maxOpenQuestions: 16,
  maxOpenQuestionUtf16Chars: 500,
  maxSourceItems: 20_000,
  maxSourceProjectedUtf8Bytes: 16 * 1024 * 1024,
  maxAttachmentsPerMessage: 1000,
} as const

export type ValidationLimits = {
  maxCandidateUtf8Bytes: number
  maxNodeDepth: number
  maxNodesTotal: number
  maxFacts: number
  maxQuotesPerFact: number
  maxQuoteUtf16Chars: number
  maxNarrativeUtf16Chars: number
  maxOpenQuestions: number
  maxOpenQuestionUtf16Chars: number
  maxSourceItems: number
  maxSourceProjectedUtf8Bytes: number
  maxAttachmentsPerMessage: number
}

export type LimitKey = keyof ValidationLimits

export type ValidationLimitsOverride = Partial<Record<LimitKey, number>>

export const VALIDATION_FAIL_CODES = {
  not_plain_json: "not_plain_json",
  parse_failed: "parse_failed",
  oversize: "oversize",
  schema_mismatch: "schema_mismatch",
  ref_not_found: "ref_not_found",
  ref_ambiguous: "ref_ambiguous",
  ref_ineligible: "ref_ineligible",
  scope_mismatch: "scope_mismatch",
  role_forged: "role_forged",
  quote_mismatch: "quote_mismatch",
  source_too_many_items: "source_too_many_items",
  source_oversize: "source_oversize",
  deadline: "deadline",
  cancelled: "cancelled",
} as const

export type ValidationFailCode = keyof typeof VALIDATION_FAIL_CODES

export type ValidationOutcome =
  | { kind: "accept"; payload: MemoryPayload }
  | { kind: "reject"; reason: ValidationFailCode }

export type PayloadSourceRef = {
  id: string
  createdAtMicros: string
}

export type AttributionKind = "contact" | "staff" | "automation" | "unknown"

export type MemoryPayload = {
  version: 1
  facts: readonly {
    attribution: AttributionKind
    quotes: readonly { ref: PayloadSourceRef; text: string }[]
  }[]
  narrative: {
    text: string
    nonAuthoritative: true
  }
  openQuestions: readonly {
    text: string
    nonAuthoritative: true
  }[]
}

export type MemoryAttachmentView = {
  id: string
  fileType: string
  mimeType: string
  name: string | null
}

export type PreparedMemorySource = {
  attachments: readonly MemoryAttachmentView[]
  ref: PayloadSourceRef
  id: string
  createdAtMicros: string
  conversationId: string
  workspaceId: string
  text: string | null
  type: string
  deletedAtMicros: string | null
  attribution: AttributionKind
  eligible: boolean
}

export type SourceMessageView = {
  id: string
  createdAtMicros: string
  attribution: AttributionKind
  text: string | null
  attachments: readonly MemoryAttachmentView[]
}

export type PromptMessage = {
  role: "system" | "user"
  content: string
}

export type MemoryValidationOptions = {
  limits?: ValidationLimitsOverride
  nowMs?: () => number
}

export type MemoryParseOptions = MemoryValidationOptions & {
  deadlineAtMs?: number
  signal?: AbortSignal
}

export const sourceRefSchema = z
  .strictObject({
    id: z.string(),
    createdAtMicros: z.string(),
  })
  .refine(
    (ref) => {
      try {
        compareRefsAsc(ref as MessageRef, ref as MessageRef)
        return true
      } catch {
        return false
      }
    },
    { message: "invalid_message_ref" },
  )

export const attributionKindSchema = z.enum([
  "contact",
  "staff",
  "automation",
  "unknown",
])

export const quoteSchema = z.strictObject({
  ref: sourceRefSchema,
  text: z.string().min(1).max(VALIDATION_LIMITS.maxQuoteUtf16Chars),
})

export const factSchema = z.strictObject({
  attribution: attributionKindSchema,
  quotes: z.array(quoteSchema).min(1).max(VALIDATION_LIMITS.maxQuotesPerFact),
})

export const narrativeSchema = z
  .strictObject({
    text: z.string().max(VALIDATION_LIMITS.maxNarrativeUtf16Chars).default(""),
    nonAuthoritative: z.literal(true),
  })
  .default({ text: "", nonAuthoritative: true })

export const openQuestionSchema = z.strictObject({
  text: z.string().min(1).max(VALIDATION_LIMITS.maxOpenQuestionUtf16Chars),
  nonAuthoritative: z.literal(true),
})

export const memoryPayloadSchema = z.strictObject({
  version: z.literal(1),
  facts: z.array(factSchema).max(VALIDATION_LIMITS.maxFacts),
  narrative: narrativeSchema,
  openQuestions: z
    .array(openQuestionSchema)
    .max(VALIDATION_LIMITS.maxOpenQuestions)
    .default([]),
})
