import {
  resolveVoiceCallPolicy,
  voiceAgentService,
} from "@chatbotx.io/business"
import {
  possibleErrorsOnMutatingResource,
  possibleErrorsOnReadingWithBody,
} from "@/lib/orpc/orpc-error-helper"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import { POLICY_CHECK_PATH } from "../lib/api-paths"
import {
  voiceAgentCheckPolicyInputSchema,
  voiceAgentCheckPolicyOutputSchema,
  voiceAgentOptOutInputSchema,
  voiceAgentOptOutOutputSchema,
} from "../schema/public"

const api = workspaceTokenAuthAPIForScope("voiceAgent")

export const voiceAgentPublicRouter = {
  checkPolicy: api
    .route({
      method: "POST",
      path: POLICY_CHECK_PATH,
      summary: "Check whether voice calls are allowed",
      description:
        "Read-only check: returns whether automated calls to this phone number are allowed. Never creates contacts.",
      tags: ["Voice agent"],
    })
    .input(voiceAgentCheckPolicyInputSchema)
    .output(voiceAgentCheckPolicyOutputSchema)
    .errors(possibleErrorsOnReadingWithBody)
    .handler(async ({ input, context }) =>
      resolveVoiceCallPolicy({
        workspaceId: context.workspace.id,
        phone: input.phone,
      }),
    ),
  optOut: api
    .route({
      method: "POST",
      path: "/v1/voice-agent/opt-out",
      summary: "Opt phone number out of voice calls",
      description:
        "Records that automated voice calls must not be placed to specified phone number or contact. Provide `phone`, `contactId`, or both. `reason` is optional metadata, and `externalSessionId` is reserved for future call log and is not stored yet.",
      tags: ["Voice agent"],
    })
    .input(voiceAgentOptOutInputSchema)
    .output(voiceAgentOptOutOutputSchema)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ input, context }) =>
      voiceAgentService.setAiCallOptOut({
        workspaceId: context.workspace.id,
        phone: input.phone,
        contactId: input.contactId,
        source: "clientCall",
        reason: input.reason,
      }),
    ),
}
