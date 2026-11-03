"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chatbotx.io/ui/components/ui/dropdown-menu"
import { useQueryClient } from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveXIcon,
  EllipsisVerticalIcon,
  MailIcon,
  PhoneIcon,
  PhoneOffIcon,
  StarIcon,
  StarOffIcon,
  TrashIcon,
  UserLockIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"
import { useWorkspaceId } from "@/hooks/routing"
import { orpc } from "@/lib/orpc/query"
import { useChatStore } from "../chat/store/chat-store-provider"
import { blockContactAction } from "../contacts/actions/block-contact.action"
import { clearAiCallOptOutAction } from "../contacts/actions/clear-ai-call-opt-out.action"
import { setAiCallOptOutAction } from "../contacts/actions/set-ai-call-opt-out.action"
import { unblockContactAction } from "../contacts/actions/unblock-contact.action"
import DeleteContactDialog from "../contacts/components/remove-contact-dialog"
import { archiveConversationAction } from "./actions/archive-conversation.action"
import { followConversationAction } from "./actions/follow-conversation.action"
import { unarchiveConversationAction } from "./actions/unarchive-conversation.action"
import { unfollowConversationAction } from "./actions/unfollow-conversation.action"
import { ThreadControlPassMenuItem } from "./components/thread-control-pass-menu-item"
import { useMarkConversationUnread } from "./hooks/use-mark-conversation-unread"
import type { ListConversationItemResource } from "./schema/resource"

type ConversationActionProps = {
  conversation: ListConversationItemResource
}

export function ConversationAction({ conversation }: ConversationActionProps) {
  const t = useTranslations()
  const workspaceId = useWorkspaceId()
  const queryClient = useQueryClient()

  const {
    deleteConversation,
    updateConversation,
    resetState: resetConversationState,
    loadMoreConversations,
  } = useChatStore((state) => state)

  const { execute: followUpFn, isExecuting: isFollowingUp } = useAction(
    followConversationAction.bind(null, workspaceId, conversation.id),
    {
      onSuccess: () => {
        updateConversation(conversation.id, {
          followed: true,
        })
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError)
        }
      },
    },
  )

  const { execute: removeFollowUpFn, isExecuting: isRemovingFollowUp } =
    useAction(
      unfollowConversationAction.bind(null, workspaceId, conversation.id),
      {
        onSuccess: () => {
          updateConversation(conversation.id, {
            followed: false,
          })
        },
        onError: ({ error }) => {
          if (error.serverError) {
            toast.error(error.serverError)
          }
        },
      },
    )

  const { markAsUnread, isMarkingUnread } = useMarkConversationUnread(
    conversation.id,
  )

  const { execute: archiveFn, isExecuting: isArchiving } = useAction(
    archiveConversationAction.bind(null, workspaceId),
    {
      onSuccess: () => {
        // updateConversation(conversation.id, {
        //   archivedAt: new Date(),
        // })

        // Reload conversation list
        resetConversationState()
        loadMoreConversations(workspaceId)
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError)
        }
      },
    },
  )

  const { execute: unarchiveFn, isExecuting: isUnarchiving } = useAction(
    unarchiveConversationAction.bind(null, workspaceId),
    {
      onSuccess: () => {
        // updateConversation(conversation.id, {
        //   archivedAt: null,
        // })

        // Reload conversation list
        resetConversationState()
        loadMoreConversations(workspaceId)
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError)
        }
      },
    },
  )

  const { execute: blockContactFn, isExecuting: isBlockingContact } = useAction(
    blockContactAction.bind(null, workspaceId, conversation.contactId),
    {
      onSuccess: () => {
        // updateContact(conversation.contactId, {
        //   blockedAt: new Date(),
        // })

        // Reload conversation list
        resetConversationState()
        loadMoreConversations(workspaceId)
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError)
        }
      },
    },
  )

  const { execute: unblockContactFn } = useAction(
    unblockContactAction.bind(null, workspaceId, conversation.contactId),
    {
      onSuccess: () => {
        // updateContact(conversation.contactId, {
        //   blockedAt: null,
        // })

        // Reload conversation list
        resetConversationState()
        loadMoreConversations(workspaceId)
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError)
        }
      },
    },
  )

  const { execute: setAiCallOptOutFn, isExecuting: isSettingAiCallOptOut } =
    useAction(
      setAiCallOptOutAction.bind(null, workspaceId, conversation.contactId),
      {
        onSuccess: () => {
          resetConversationState()
          loadMoreConversations(workspaceId)
          queryClient.invalidateQueries({ queryKey: orpc.contactsAPIs.key() })
        },
        onError: ({ error }) => {
          if (error.serverError) {
            toast.error(error.serverError)
          }
        },
      },
    )

  const { execute: clearAiCallOptOutFn, isExecuting: isClearingAiCallOptOut } =
    useAction(
      clearAiCallOptOutAction.bind(null, workspaceId, conversation.contactId),
      {
        onSuccess: () => {
          resetConversationState()
          loadMoreConversations(workspaceId)
          queryClient.invalidateQueries({ queryKey: orpc.contactsAPIs.key() })
        },
        onError: ({ error }) => {
          if (error.serverError) {
            toast.error(error.serverError)
          }
        },
      },
    )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost">
            <EllipsisVerticalIcon />
          </Button>
        }
      />
      <DropdownMenuContent className="w-56">
        {conversation.followed ? (
          <DropdownMenuItem
            disabled={isRemovingFollowUp}
            onClick={() => removeFollowUpFn()}
          >
            <StarOffIcon />
            {t("actions.removeFromFollowUp")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={isFollowingUp}
            onClick={() => followUpFn()}
          >
            <StarIcon className="fill-yellow-400 text-yellow-400" />
            {t("actions.markAsFollowUp")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={isMarkingUnread}
          onClick={() => markAsUnread()}
        >
          <MailIcon />
          {t("actions.markAsUnread")}
        </DropdownMenuItem>
        {conversation.archivedAt ? (
          <DropdownMenuItem
            disabled={isUnarchiving}
            onClick={() => unarchiveFn({ ids: [conversation.id] })}
          >
            <ArchiveXIcon />
            {t("actions.unarchive")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={isArchiving}
            onClick={() => archiveFn({ ids: [conversation.id] })}
          >
            <ArchiveIcon />
            {t("actions.archive")}
          </DropdownMenuItem>
        )}
        {conversation.contact?.blockedAt ? (
          <DropdownMenuItem onClick={() => unblockContactFn()}>
            <UserLockIcon />
            {t("actions.unblockContact")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={isBlockingContact}
            onClick={() => blockContactFn()}
          >
            <UserLockIcon />
            {t("actions.blockContact")}
          </DropdownMenuItem>
        )}
        {conversation.contact?.aiCallOptOutAt ? (
          <DropdownMenuItem
            disabled={isClearingAiCallOptOut}
            onClick={() => clearAiCallOptOutFn()}
          >
            <PhoneIcon />
            {t("contactAiCalls.menuEnable")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={isSettingAiCallOptOut}
            onClick={() => setAiCallOptOutFn({})}
          >
            <PhoneOffIcon />
            {t("contactAiCalls.menuDisable")}
          </DropdownMenuItem>
        )}

        <ThreadControlPassMenuItem conversation={conversation} />

        <DeleteContactDialog
          ids={[conversation.contact?.id || ""]}
          onSuccess={() => {
            deleteConversation(conversation.id)
          }}
          trigger={
            <DropdownMenuItem
              closeOnClick={false}
              onClick={(e) => e.preventDefault()}
            >
              <TrashIcon className="text-destructive" />
              {t("actions.deleteContact")}
            </DropdownMenuItem>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
