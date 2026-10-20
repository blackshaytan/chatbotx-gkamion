"use server"

import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { setDromEnabled } from "../lib/drom-connection"
import { setDromEnabledRequest } from "../schema/request"

export const setDromEnabledAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(setDromEnabledRequest)
  .action(
    async ({ parsedInput, bindArgsParsedInputs: [workspaceId], ctx }) =>
      await setDromEnabled({
        workspaceId,
        userId: ctx.user.id,
        connectionId: parsedInput.connectionId,
        enabled: parsedInput.enabled,
      }),
  )
