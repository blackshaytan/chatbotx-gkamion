"use client"

import type { ConversationHandoverCategory } from "@chatbotx.io/database/partials"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { BotIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { useChatStore } from "@/features/chat/store/chat-store-provider"
import { useInvalidateContacts } from "@/features/contacts/hooks/use-contacts"
import { HANDOVER_CATEGORY_META } from "../lib/handover-category"
import type { ConversationResource } from "../schema/resource"
import {
  BOT_RESUMED_PATCH,
  getBotPausedUntil,
  isAwaitingManager,
} from "../utils/bot-state"
import EnableBotDialog from "./enable-bot-dialog"

const TIME_FORMAT = { hour: "2-digit", minute: "2-digit" } as const

type BotStateBarState =
  | {
      kind: "awaitingManager"
      handoverCategory: ConversationHandoverCategory | null
    }
  | { kind: "paused"; until: Date }

/**
 * Why the bar is shown, or null while the bot answers. A handover that left
 * the bot off means a manager is awaited; otherwise a bot paused into the
 * future shows when it resumes.
 */
const resolveBotStateBar = (
  conversation: ConversationResource,
): BotStateBarState | null => {
  if (isAwaitingManager(conversation)) {
    return {
      kind: "awaitingManager",
      handoverCategory: conversation.handoverCategory,
    }
  }
  const until = getBotPausedUntil(conversation)
  return until ? { kind: "paused", until } : null
}

const resolveAwaitingMessage = (
  handoverCategory: ConversationHandoverCategory | null,
  t: ReturnType<typeof useTranslations>,
): string =>
  handoverCategory
    ? t("inboxAttention.waitingManagerWithCategory", {
        category: t(HANDOVER_CATEGORY_META[handoverCategory].labelKey),
      })
    : t("inboxAttention.waitingManager")

/**
 * Header bar for a conversation whose bot is off. "Return to bot" reuses the
 * enable-bot dialog and clears the handover state in the store.
 */
export function BotStateBar({
  conversation,
}: {
  conversation: ConversationResource
}) {
  const barState = resolveBotStateBar(conversation)
  if (!barState) {
    return null
  }

  return <BotStateBarContent barState={barState} conversation={conversation} />
}

// Split from `BotStateBar` so an idle conversation renders without touching
// the query client or formatter providers.
function BotStateBarContent({
  barState,
  conversation,
}: {
  barState: BotStateBarState
  conversation: ConversationResource
}) {
  const t = useTranslations()
  const format = useFormatter()
  const updateConversation = useChatStore((state) => state.updateConversation)
  const invalidateContacts = useInvalidateContacts()

  const message =
    barState.kind === "awaitingManager"
      ? resolveAwaitingMessage(barState.handoverCategory, t)
      : t("inboxAttention.botPausedUntil", {
          time: format.dateTime(barState.until, TIME_FORMAT),
        })

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/50 px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <BotIcon aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{message}</span>
      </span>
      <EnableBotDialog
        ids={[conversation.id]}
        onSuccess={() => {
          updateConversation(conversation.id, BOT_RESUMED_PATCH)
          invalidateContacts()
        }}
        trigger={
          <Button className="shrink-0" size="sm" variant="secondary">
            {t("inboxAttention.returnToBot")}
          </Button>
        }
      />
    </div>
  )
}
