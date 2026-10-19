"use server"

import { workspaceIdAndIdRequestParams } from "@/features/common/schema"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"
import { disconnectMax } from "./handlers"

export const disconnectMaxAction = workspaceActionClientAllowExpired
  .bindArgsSchemas(workspaceIdAndIdRequestParams)
  .action(
    async ({ bindArgsParsedInputs: [workspaceId, connectionId], ctx }) =>
      await disconnectMax({ workspaceId, userId: ctx.user.id, connectionId }),
  )
