"use server"
import { conversationService, messageService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { resolveMemberHiddenInboxIds } from "@/features/conversations/lib/member-inbox-access"
import { workspaceActionClient } from "@/lib/safe-action"
import { createMessageWithRoutingBypassRequest } from "../schema/mutation"
export const createMessageAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(createMessageWithRoutingBypassRequest)
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, conversationId],
      parsedInput,
      ctx,
    } = props

    const conversation = await conversationService.findByOrFail({
      where: {
        id: conversationId,
        workspaceId,
      },
    })

    const hiddenInboxIds = await resolveMemberHiddenInboxIds({
      workspaceId,
      userId: ctx.user.id,
      permissions: ctx.workspaceMemberPermissions,
    })
    const contactInbox =
      await conversationService.resolveContactInboxForConversation({
        conversation,
        workspaceId,
        inboxId: parsedInput.inboxId,
        hiddenInboxIds,
        viewerUserId: ctx.user.id,
      })

    return messageService.createOutgoing({
      conversation,
      contactInbox,
      input: parsedInput,
      user: ctx.user,
    })
  })
