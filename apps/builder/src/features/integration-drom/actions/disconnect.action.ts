"use server"

import { workspaceIdAndIdRequestParams } from "@/features/common/schema"
import { assertWorkspaceSuperAdmin } from "@/lib/auth/assert-workspace-super-admin"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"
import { disconnectDrom } from "../lib/drom-connection"

export const disconnectDromAction = workspaceActionClientAllowExpired
  .bindArgsSchemas(workspaceIdAndIdRequestParams)
  .action(
    async ({ bindArgsParsedInputs: [workspaceId, connectionId], ctx }) => {
      await assertWorkspaceSuperAdmin(workspaceId)
      return await disconnectDrom({
        workspaceId,
        userId: ctx.user.id,
        connectionId,
      })
    },
  )
