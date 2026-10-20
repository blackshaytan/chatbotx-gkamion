"use server"

import { workspaceIdrequestParams } from "@/features/common/schema"
import { assertWorkspaceSuperAdmin } from "@/lib/auth/assert-workspace-super-admin"
import { workspaceActionClient } from "@/lib/safe-action"
import { connectDrom } from "../lib/drom-connection"
import { connectDromRequest } from "../schema/request"

export const connectDromAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(connectDromRequest)
  .action(async ({ parsedInput, bindArgsParsedInputs: [workspaceId], ctx }) => {
    await assertWorkspaceSuperAdmin(workspaceId)
    return await connectDrom({
      workspaceId,
      userId: ctx.user.id,
      config: parsedInput,
    })
  })
