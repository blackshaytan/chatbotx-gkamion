import {
  type ConversationBotCategory,
  conversationBotCategories,
} from "@chatbotx.io/database/partials"

/** The only inbox bot-category a regular member may list or pick. */
export const inboxHumanBotCategory = conversationBotCategories.enum.human

/**
 * Workspace admins (the owner, or a member with the superAdmin permission)
 * choose All / Human / Bot. A regular member only gets Human.
 */
export const inboxBotCategoryOptionValues = (
  canFilterBotCategory: boolean,
): ConversationBotCategory[] =>
  canFilterBotCategory
    ? [
        conversationBotCategories.enum.all,
        conversationBotCategories.enum.human,
        conversationBotCategories.enum.bot,
      ]
    : [inboxHumanBotCategory]

/**
 * Admins keep the category they asked for (`undefined` means every
 * conversation). Regular members are pinned to Human even when the client
 * sends All or Bot.
 */
export const resolveInboxListBotCategory = <T extends object>(
  input: T,
  canFilterBotCategory: boolean,
): T => {
  if (canFilterBotCategory) {
    return input
  }
  // Callers pass a full list request. The constraint stays `object` so
  // TypeScript keeps fields such as workspaceId instead of reducing the
  // request to the optional category.
  return { ...input, botCategory: inboxHumanBotCategory } as T
}
