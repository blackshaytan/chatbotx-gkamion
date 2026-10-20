"use server"

import { workspaceIdAndIdRequestParams } from "@/features/common/schema"
import { assertWorkspaceSuperAdmin } from "@/lib/auth/assert-workspace-super-admin"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"
import { disconnectMax } from "../lib/max-connection"

export const disconnectMaxAction = workspaceActionClientAllowExpired
  .bindArgsSchemas(workspaceIdAndIdRequestParams)
  .action(
    async ({ bindArgsParsedInputs: [workspaceId, connectionId], ctx }) => {
      await assertWorkspaceSuperAdmin(workspaceId)
      return await disconnectMax({
        workspaceId,
        userId: ctx.user.id,
        connectionId,
      })
    },
  )
