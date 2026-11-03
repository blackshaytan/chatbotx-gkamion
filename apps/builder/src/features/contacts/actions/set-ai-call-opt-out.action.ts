"use server"

import { voiceAgentService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"
import { workspaceActionClient } from "@/lib/safe-action"
import { requireContactPermissionScope } from "../permissions"

export const setAiCallOptOutAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(z.object({ reason: z.string().max(500).optional() }))
  .action(
    async ({ bindArgsParsedInputs: [workspaceId, id], parsedInput, ctx }) => {
      await requireContactPermissionScope(workspaceId)
      return await voiceAgentService.setAiCallOptOut({
        workspaceId,
        contactId: id,
        source: "manager",
        reason: parsedInput.reason,
        actorUserId: ctx.user.id,
      })
    },
  )
