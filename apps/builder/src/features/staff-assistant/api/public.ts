import { staffAssistantService } from "@chatbotx.io/business"
import {
  possibleErrorsOnListingResource,
  possibleErrorsOnTestingExternalAgent,
  possibleErrorsOnUpdatingExternalAgent,
} from "@/lib/orpc/orpc-error-helper"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import {
  staffAssistantSettingsSchema,
  staffAssistantTestSchema,
  updateStaffAssistantSchema,
} from "../schema"

const settingsAPI = workspaceTokenAuthAPIForScope("settings")
const notice =
  "The assistant acts with all permissions of its token, independently of the employee's permissions. Enable it only if all employees may use that access."

export const staffAssistantPublicRouter = {
  get: settingsAPI
    .route({
      method: "GET",
      path: "/v1/staff-assistant",
      summary: "Get staff assistant settings",
      description: `Returns staff assistant settings without its secret. ${notice}`,
      tags: ["Staff Assistant"],
    })
    .output(staffAssistantSettingsSchema.nullable())
    .errors(possibleErrorsOnListingResource)
    .handler(
      async ({ context }) =>
        await staffAssistantService.get(context.workspace.id),
    ),
  update: settingsAPI
    .route({
      method: "PATCH",
      path: "/v1/staff-assistant",
      summary: "Update staff assistant settings",
      description: `Updates the assistant; the key is write-only. Get token ids from \`token.get\`; the token must explicitly include \`chats\`. ${notice}`,
      tags: ["Staff Assistant"],
    })
    .input(updateStaffAssistantSchema)
    .output(staffAssistantSettingsSchema)
    .errors(possibleErrorsOnUpdatingExternalAgent)
    .handler(
      async ({ context, input }) =>
        await staffAssistantService.update(context.workspace.id, input),
    ),
  test: settingsAPI
    .route({
      method: "POST",
      path: "/v1/staff-assistant/test",
      summary: "Test staff assistant connection",
      description:
        "Checks the configured assistant endpoint and records the result. Repeat checks within 10 seconds are rejected.",
      tags: ["Staff Assistant"],
    })
    .output(staffAssistantTestSchema)
    .errors(possibleErrorsOnTestingExternalAgent)
    .handler(
      async ({ context }) =>
        await staffAssistantService.test(context.workspace.id),
    ),
}
