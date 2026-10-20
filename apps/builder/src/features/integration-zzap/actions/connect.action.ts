"use server"

import { workspaceIdrequestParams } from "@/features/common/schema"
import { assertWorkspaceSuperAdmin } from "@/lib/auth/assert-workspace-super-admin"
import { workspaceActionClient } from "@/lib/safe-action"
import { connectZzap } from "../lib/zzap-connection"
import { connectZzapRequest } from "../schema/request"

export const connectZzapAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(connectZzapRequest)
  .action(async ({ parsedInput, bindArgsParsedInputs: [workspaceId], ctx }) => {
    await assertWorkspaceSuperAdmin(workspaceId)
    return await connectZzap({
      workspaceId,
      userId: ctx.user.id,
      config: parsedInput,
    })
  })
