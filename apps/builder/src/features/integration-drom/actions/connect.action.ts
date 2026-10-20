"use server"

import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { connectDrom } from "../lib/drom-connection"
import { connectDromRequest } from "../schema/request"

export const connectDromAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(connectDromRequest)
  .action(
    async ({ parsedInput, bindArgsParsedInputs: [workspaceId], ctx }) =>
      await connectDrom({
        workspaceId,
        userId: ctx.user.id,
        config: parsedInput,
      }),
  )
