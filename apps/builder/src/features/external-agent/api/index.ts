import { externalAgentService } from "@chatbotx.io/business"
import { ORPCError } from "@orpc/server"
import { withWorkspaceIdSchema } from "@/features/workspaces/schema/resource"
import {
  hasWorkspacePermission,
  type PermissionsInput,
} from "@/lib/auth/permission-routes"
import {
  possibleErrorsOnListingResource,
  possibleErrorsOnTestingExternalAgent,
  possibleErrorsOnUpdatingExternalAgent,
} from "@/lib/orpc/orpc-error-helper"
import { workspaceAuthorizedMidddleware } from "@/middlewares/auth"
import { authorizedAPI } from "@/orpc"
import {
  externalAgentOutputSchema,
  externalAgentTestOutputSchema,
  updateExternalAgentInputSchema,
} from "../schema"

/** The external agent holds an API key and a live endpoint, so it is managed with the same `superAdmin` flag as the settings pages. */
const assertCanManageExternalAgent = (permissions: PermissionsInput) => {
  if (!hasWorkspacePermission(permissions, "superAdmin")) {
    throw new ORPCError("FORBIDDEN")
  }
}

const get = authorizedAPI
  .route({
    method: "GET",
    path: "/workspaces/{workspaceId}/external-agent",
    summary: "Get external agent settings",
    tags: ["External Agent"],
  })
  .input(withWorkspaceIdSchema)
  .output(externalAgentOutputSchema.nullable())
  .errors(possibleErrorsOnListingResource)
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .handler(async ({ context, input }) => {
    assertCanManageExternalAgent(context.workspaceMember.permissions)
    return await externalAgentService.get(input.workspaceId)
  })

const update = authorizedAPI
  .route({
    method: "PATCH",
    path: "/workspaces/{workspaceId}/external-agent",
    summary: "Update external agent settings",
    tags: ["External Agent"],
  })
  .input(updateExternalAgentInputSchema.and(withWorkspaceIdSchema))
  .output(externalAgentOutputSchema)
  .errors(possibleErrorsOnUpdatingExternalAgent)
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .handler(async ({ context, input }) => {
    assertCanManageExternalAgent(context.workspaceMember.permissions)
    const { workspaceId, ...settings } = input
    return await externalAgentService.update(workspaceId, settings)
  })

const test = authorizedAPI
  .route({
    method: "POST",
    path: "/workspaces/{workspaceId}/external-agent/test",
    summary: "Run external agent health check",
    tags: ["External Agent"],
  })
  .input(withWorkspaceIdSchema)
  .output(externalAgentTestOutputSchema)
  .errors(possibleErrorsOnTestingExternalAgent)
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .handler(async ({ context, input }) => {
    assertCanManageExternalAgent(context.workspaceMember.permissions)
    return await externalAgentService.test(input.workspaceId)
  })

export const externalAgentAPI = {
  get,
  update,
  test,
}
