"use server"

import { workspaceIdAndIdRequestParams } from "@/features/common/schema"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"
import { disconnectZzap } from "../lib/zzap-connection"

export const disconnectZzapAction = workspaceActionClientAllowExpired
  .bindArgsSchemas(workspaceIdAndIdRequestParams)
  .action(
    async ({ bindArgsParsedInputs: [workspaceId, connectionId], ctx }) =>
      await disconnectZzap({ workspaceId, userId: ctx.user.id, connectionId }),
  )
