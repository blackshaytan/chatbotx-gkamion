import { staffAssistantService } from "@chatbotx.io/business"
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
  staffAssistantSettingsSchema,
  staffAssistantTestSchema,
  updateStaffAssistantSchema,
} from "../schema"

const assertCanManage = (permissions: PermissionsInput) => {
  if (!hasWorkspacePermission(permissions, "superAdmin")) {
    throw new ORPCError("FORBIDDEN")
  }
}

export const staffAssistantAPI = {
  get: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/staff-assistant",
      summary: "Get staff assistant settings",
      tags: ["Staff Assistant"],
    })
    .input(withWorkspaceIdSchema)
    .output(staffAssistantSettingsSchema.nullable())
    .errors(possibleErrorsOnListingResource)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      assertCanManage(context.workspaceMember.permissions)
      return await staffAssistantService.get(input.workspaceId)
    }),
  update: authorizedAPI
    .route({
      method: "PATCH",
      path: "/workspaces/{workspaceId}/staff-assistant",
      summary: "Update staff assistant settings",
      tags: ["Staff Assistant"],
    })
    .input(updateStaffAssistantSchema.extend(withWorkspaceIdSchema.shape))
    .output(staffAssistantSettingsSchema)
    .errors(possibleErrorsOnUpdatingExternalAgent)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      assertCanManage(context.workspaceMember.permissions)
      const { workspaceId, ...settings } = input
      return await staffAssistantService.update(workspaceId, settings)
    }),
  test: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/staff-assistant/test",
      summary: "Test staff assistant connection",
      tags: ["Staff Assistant"],
    })
    .input(withWorkspaceIdSchema)
    .output(staffAssistantTestSchema)
    .errors(possibleErrorsOnTestingExternalAgent)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      assertCanManage(context.workspaceMember.permissions)
      return await staffAssistantService.test(input.workspaceId)
    }),
}
