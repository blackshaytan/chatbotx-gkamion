"use server"

import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { setMaxEnabledRequest } from "../schema/request"
import { setMaxEnabled } from "./handlers"

export const setMaxEnabledAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(setMaxEnabledRequest)
  .action(
    async ({ parsedInput, bindArgsParsedInputs: [workspaceId], ctx }) =>
      await setMaxEnabled({
        workspaceId,
        userId: ctx.user.id,
        connectionId: parsedInput.connectionId,
        enabled: parsedInput.enabled,
      }),
  )
