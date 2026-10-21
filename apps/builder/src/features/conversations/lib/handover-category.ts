import type { ConversationHandoverCategory } from "@chatbotx.io/database/partials"

/**
 * Presentation of the handover categories the external AI agent picks, shared by
 * the list row, the chat header bar, the filter and the handover note. The
 * label keys are literal so every translation stays auditable by text search.
 */
export const HANDOVER_CATEGORY_META = {
  urgent: { emoji: "🔥", labelKey: "inboxAttention.handoverCategory.urgent" },
  return: { emoji: "↩️", labelKey: "inboxAttention.handoverCategory.return" },
  payment: { emoji: "💳", labelKey: "inboxAttention.handoverCategory.payment" },
  orderStatus: {
    emoji: "📦",
    labelKey: "inboxAttention.handoverCategory.orderStatus",
  },
  delivery: {
    emoji: "🚚",
    labelKey: "inboxAttention.handoverCategory.delivery",
  },
  priceAndTerm: {
    emoji: "💰",
    labelKey: "inboxAttention.handoverCategory.priceAndTerm",
  },
  other: { emoji: "💬", labelKey: "inboxAttention.handoverCategory.other" },
} as const satisfies Record<
  ConversationHandoverCategory,
  { emoji: string; labelKey: string }
>
