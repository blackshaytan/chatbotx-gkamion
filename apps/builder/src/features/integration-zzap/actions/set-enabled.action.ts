"use server"

import { workspaceIdrequestParams } from "@/features/common/schema"
import { assertWorkspaceSuperAdmin } from "@/lib/auth/assert-workspace-super-admin"
import { workspaceActionClient } from "@/lib/safe-action"
import { setZzapEnabled } from "../lib/zzap-connection"
import { setZzapEnabledRequest } from "../schema/request"

export const setZzapEnabledAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(setZzapEnabledRequest)
  .action(async ({ parsedInput, bindArgsParsedInputs: [workspaceId], ctx }) => {
    await assertWorkspaceSuperAdmin(workspaceId)
    return await setZzapEnabled({
      workspaceId,
      userId: ctx.user.id,
      connectionId: parsedInput.connectionId,
      enabled: parsedInput.enabled,
    })
  })
