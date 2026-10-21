import {
  conversationHandoverCategories,
  EXTERNAL_AGENT_ACTIVITY_TYPE,
} from "@chatbotx.io/database/partials"
import { describe, expect, test } from "vitest"
import { HANDOVER_CATEGORY_META } from "@/features/conversations/lib/handover-category"
import { formatUnreadBadge } from "@/features/conversations/lib/unread-badge"
import {
  BOT_RESUMED_PATCH,
  getBotPausedUntil,
  isAwaitingManager,
  isConversationActive,
} from "@/features/conversations/utils/bot-state"
import {
  formatExternalAgentActivity,
  getExternalAgentActivity,
} from "@/features/external-agent/lib/activity"

const HOUR_MS = 60 * 60 * 1000

type Translate = Parameters<typeof formatExternalAgentActivity>[1]

const parseActivity = (contentAttributes: unknown) => {
  const activity = getExternalAgentActivity(contentAttributes)
  if (!activity) {
    throw new Error("expected a parseable external agent activity")
  }
  return activity
}

const translate = ((key: string, values?: Record<string, string>) =>
  values ? `${key} ${JSON.stringify(values)}` : key) as unknown as Translate

describe("handover category presentation", () => {
  test("every handover category has an emoji and a label key", () => {
    expect(Object.keys(HANDOVER_CATEGORY_META).sort()).toEqual(
      [...conversationHandoverCategories.options].sort(),
    )
    expect(
      Object.fromEntries(
        Object.entries(HANDOVER_CATEGORY_META).map(([key, meta]) => [
          key,
          meta.emoji,
        ]),
      ),
    ).toEqual({
      urgent: "🔥",
      return: "↩️",
      payment: "💳",
      orderStatus: "📦",
      delivery: "🚚",
      priceAndTerm: "💰",
      other: "💬",
    })
  })

  test("the handover note names the category before the reason", () => {
    const activity = parseActivity({
      type: EXTERNAL_AGENT_ACTIVITY_TYPE,
      event: "handover",
      reason: "Customer wants a refund",
      category: "return",
    })

    expect(formatExternalAgentActivity(activity, translate)).toBe(
      `externalAgent.activity.handoverWithCategory {"category":"inboxAttention.handoverCategory.return","reason":"Customer wants a refund"}`,
    )
  })

  test("the handover note with a category but no reason omits the reason", () => {
    const activity = parseActivity({
      type: EXTERNAL_AGENT_ACTIVITY_TYPE,
      event: "handover",
      category: "delivery",
    })

    expect(formatExternalAgentActivity(activity, translate)).toBe(
      `externalAgent.activity.handoverWithCategoryNoReason {"category":"inboxAttention.handoverCategory.delivery"}`,
    )
  })

  test("a legacy handover note without a category keeps the old sentence", () => {
    const withReason = parseActivity({
      type: EXTERNAL_AGENT_ACTIVITY_TYPE,
      event: "handover",
      reason: "Asked for a manager",
    })
    const withoutReason = parseActivity({
      type: EXTERNAL_AGENT_ACTIVITY_TYPE,
      event: "handover",
    })

    expect(formatExternalAgentActivity(withReason, translate)).toBe(
      `externalAgent.activity.handover {"reason":"Asked for a manager"}`,
    )
    expect(formatExternalAgentActivity(withoutReason, translate)).toBe(
      "externalAgent.activity.handoverNoReason",
    )
  })
})

describe("unread badge", () => {
  test("shows the count and caps it at 99+", () => {
    expect(formatUnreadBadge(1)).toBe("1")
    expect(formatUnreadBadge(99)).toBe("99")
    expect(formatUnreadBadge(100)).toBe("99+")
    expect(formatUnreadBadge(250)).toBe("99+")
  })
})

describe("bot state helpers", () => {
  test("a handed-over conversation with the bot off awaits a manager", () => {
    expect(
      isAwaitingManager({
        botEnabled: false,
        botResumeAt: null,
        handedOverAt: new Date(),
      }),
    ).toBe(true)
  })

  test("an enabled bot never leaves the conversation awaiting a manager", () => {
    expect(
      isAwaitingManager({
        botEnabled: true,
        botResumeAt: null,
        handedOverAt: new Date(),
      }),
    ).toBe(false)
  })

  test("a conversation never handed over is not awaiting a manager", () => {
    expect(
      isAwaitingManager({
        botEnabled: false,
        botResumeAt: null,
        handedOverAt: null,
      }),
    ).toBe(false)
  })

  test("a bot paused until a future time reports that time", () => {
    const resumeAt = new Date(Date.now() + HOUR_MS)

    expect(
      getBotPausedUntil({ botEnabled: false, botResumeAt: resumeAt }),
    ).toEqual(resumeAt)
  })

  test("a bot whose pause has passed, or that is on, reports no pause", () => {
    expect(
      getBotPausedUntil({
        botEnabled: false,
        botResumeAt: new Date(Date.now() - HOUR_MS),
      }),
    ).toBeNull()
    expect(
      getBotPausedUntil({
        botEnabled: true,
        botResumeAt: new Date(Date.now() + HOUR_MS),
      }),
    ).toBeNull()
  })

  test("turning the bot back on clears the handover and the pause", () => {
    const resumed = {
      botEnabled: false,
      botResumeAt: new Date(Date.now() + HOUR_MS),
      handoverCategory: "urgent" as const,
      handedOverAt: new Date(),
      ...BOT_RESUMED_PATCH,
    }

    expect(resumed).toMatchObject({
      botEnabled: true,
      botResumeAt: null,
      handoverCategory: null,
      handedOverAt: null,
    })
    expect(isConversationActive(resumed)).toBe(true)
    expect(isAwaitingManager(resumed)).toBe(false)
  })
})
