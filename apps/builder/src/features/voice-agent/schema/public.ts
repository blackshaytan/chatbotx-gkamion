import { aiCallOptOutSourceSchema } from "@chatbotx.io/database/partials"
import { z } from "zod"

export const voiceAgentCheckPolicyInputSchema = z.object({
  phone: z
    .string()
    .min(1)
    .max(32)
    .describe(
      "Phone number to check. Accepts E.164 or any format the workspace can normalize.",
    ),
})

export const voiceAgentCheckPolicyOutputSchema = z.object({
  canCall: z
    .boolean()
    .describe(
      "Whether an automated voice call to this phone number is currently allowed.",
    ),
  reason: z
    .enum(["optedOut", "blocked", "invalidPhone"])
    .optional()
    .describe(
      "Why the call is not allowed when `canCall` is false. Omitted when the call is allowed.",
    ),
  contactId: z
    .string()
    .optional()
    .describe(
      "Resolved contact id for the phone number, if one exists in the workspace.",
    ),
  contactIds: z
    .array(z.string())
    .optional()
    .describe(
      "All contact ids matched to the phone number when multiple contacts share it.",
    ),
  optOutAt: z
    .date()
    .optional()
    .describe("When the phone number was opted out, if applicable."),
  optOutSource: aiCallOptOutSourceSchema
    .optional()
    .describe(
      "Channel through which the opt-out was originally recorded, if applicable.",
    ),
})

export const voiceAgentOptOutInputSchema = z
  .object({
    phone: z
      .string()
      .min(1)
      .max(32)
      .optional()
      .describe(
        "Phone number to opt out. Provide this, `contactId`, or both. Accepts E.164 or any format the workspace can normalize.",
      ),
    contactId: z
      .string()
      .optional()
      .describe(
        "Contact id to opt out. Provide this, `phone`, or both. When both are given, the contact is opted out and the phone is normalized.",
      ),
    reason: z
      .string()
      .max(500)
      .optional()
      .describe("Optional free-text reason for the opt-out."),
    externalSessionId: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Reserved for the future call log. Accepted but not stored yet.",
      ),
  })
  .refine((data) => data.phone !== undefined || data.contactId !== undefined, {
    message: "Provide phone, contactId, or both.",
    path: ["phone"],
  })

export const voiceAgentOptOutOutputSchema = z.object({
  contactIds: z
    .array(z.string())
    .describe("Contact ids affected by the opt-out."),
  alreadySet: z
    .boolean()
    .describe(
      "True if the phone number or contact was already opted out before this call.",
    ),
})
