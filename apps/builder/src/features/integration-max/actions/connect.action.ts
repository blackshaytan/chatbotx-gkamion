"use server"

import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { connectMaxRequest } from "../schema/request"
import { connectMax } from "./handlers"

export const connectMaxAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(connectMaxRequest)
  .action(
    async ({ parsedInput, bindArgsParsedInputs: [workspaceId], ctx }) =>
      await connectMax({
        workspaceId,
        userId: ctx.user.id,
        botToken: parsedInput.botToken,
      }),
  )
