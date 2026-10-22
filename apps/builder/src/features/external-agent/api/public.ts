import { externalAgentService } from "@chatbotx.io/business"
import { mcpSpec } from "@/lib/orpc/mcp-annotations"
import {
  possibleErrorsOnListingResource,
  possibleErrorsOnMutatingResource,
  possibleErrorsOnTestingExternalAgent,
  possibleErrorsOnUpdatingExternalAgent,
} from "@/lib/orpc/orpc-error-helper"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import {
  externalAgentHandoverInputSchema,
  externalAgentHandoverOutputSchema,
  externalAgentOutputSchema,
  externalAgentTestOutputSchema,
  updateExternalAgentInputSchema,
} from "../schema"

// `settings` covers the agent's configuration, `inbox` covers the handover
// that the agent performs inside a conversation.
const settingsAPI = workspaceTokenAuthAPIForScope("settings")
const inboxAPI = workspaceTokenAuthAPIForScope("inbox")

export const externalAgentPublicRouter = {
  get: settingsAPI
    .route({
      method: "GET",
      path: "/v1/external-agent",
      summary: "Get external agent settings",
      description:
        "Returns the external AI agent (Hermes) settings of the workspace: whether it is enabled, its base URL, the inboxes where it answers, its run limits, and the client-facing signature (`botName`, `signMessages`) and manager notice (`announceManager`). `apiKey` is write-only and is never returned; `hasApiKey` says whether one is stored. Returns null until the agent is configured with `externalAgent.update`. Inbox ids come from `inboxes.list`.",
      tags: ["External Agent"],
    })
    .output(externalAgentOutputSchema.nullable())
    .errors(possibleErrorsOnListingResource)
    .handler(
      async ({ context }) =>
        await externalAgentService.get(context.workspace.id),
    ),

  update: settingsAPI
    .route({
      method: "PATCH",
      path: "/v1/external-agent",
      summary: "Update external agent settings",
      description:
        "Changes the external AI agent (Hermes) settings. Only the fields you send change. Send `apiKey` to store or replace the key; it is write-only and never returned. Set `botName` with `signMessages` to sign client replies with the agent's name, and `announceManager` to tell the client once which manager took over. Inbox ids come from `inboxes.list`. Read the current values with `externalAgent.get` first.",
      tags: ["External Agent"],
    })
    .input(updateExternalAgentInputSchema)
    .output(externalAgentOutputSchema)
    .errors(possibleErrorsOnUpdatingExternalAgent)
    .handler(
      async ({ context, input }) =>
        await externalAgentService.update(context.workspace.id, input),
    ),

  test: settingsAPI
    .route({
      method: "POST",
      path: "/v1/external-agent/test",
      summary: "Run external agent health check",
      description:
        "Calls the health endpoint of the Hermes agent and stores the result as the last check, readable in `externalAgent.get` (`lastCheckStatus`, `lastCheckedAt`, `lastCheckError`). Repeated checks within 10 seconds are rejected with 429. Fails with 404 until the agent is configured with `externalAgent.update`.",
      tags: ["External Agent"],
    })
    .output(externalAgentTestOutputSchema)
    .errors(possibleErrorsOnTestingExternalAgent)
    .handler(
      async ({ context }) =>
        await externalAgentService.test(context.workspace.id),
    ),

  handover: inboxAPI
    .route({
      method: "POST",
      path: "/v1/conversations/{conversationId}/external-agent-handover",
      summary: "Hand conversation over to human manager",
      description:
        "Called by the external agent to give a conversation to a human manager with a reason and an optional `category` (`urgent`, `return`, `payment`, `orderStatus`, `delivery`, `priceAndTerm` or `other`, default `other`). The reason and category are saved as a note in the conversation, and the bot is paused for it (`botEnabled` becomes false) without resuming on its own. Conversation ids come from `conversations.list`, or from the run context the platform sent to the agent.",
      tags: ["External Agent"],
      spec: mcpSpec({ visibility: "default" }),
    })
    .input(externalAgentHandoverInputSchema)
    .output(externalAgentHandoverOutputSchema)
    .errors(possibleErrorsOnMutatingResource)
    .handler(
      async ({ context, input }) =>
        await externalAgentService.handover({
          workspaceId: context.workspace.id,
          conversationId: input.conversationId,
          reason: input.reason,
          category: input.category,
        }),
    ),
}
