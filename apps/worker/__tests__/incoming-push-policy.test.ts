// @vitest-environment node
import { describe, expect, test } from "vitest"
import {
  isBotActiveForConversation,
  shouldSendIncomingMessagePush,
} from "../src/integration/incoming-push-policy"

const NOW = new Date("2026-10-21T12:00:00.000Z")
const PAST = new Date("2026-10-21T11:00:00.000Z")
const FUTURE = new Date("2026-10-21T13:00:00.000Z")

const bot = (botEnabled: boolean, botResumeAt: Date | null) => ({
  botEnabled,
  botResumeAt,
})

describe("isBotActiveForConversation", () => {
  test("is active while the bot is enabled", () => {
    expect(isBotActiveForConversation(bot(true, null), NOW)).toBe(true)
  })

  test("is inactive when the bot is off and has no resume time", () => {
    expect(isBotActiveForConversation(bot(false, null), NOW)).toBe(false)
  })

  test("is active once a past resume time has passed", () => {
    expect(isBotActiveForConversation(bot(false, PAST), NOW)).toBe(true)
  })

  test("stays inactive while the resume time is still in the future", () => {
    expect(isBotActiveForConversation(bot(false, FUTURE), NOW)).toBe(false)
  })
})

describe("shouldSendIncomingMessagePush", () => {
  test("suppresses the push when the agent inbox's bot is active", () => {
    expect(
      shouldSendIncomingMessagePush({
        conversation: bot(true, null),
        isExternalAgentInbox: true,
        now: NOW,
      }),
    ).toBe(false)
  })

  test("suppresses the push when the agent inbox's bot is active through an ended pause", () => {
    expect(
      shouldSendIncomingMessagePush({
        conversation: bot(false, PAST),
        isExternalAgentInbox: true,
        now: NOW,
      }),
    ).toBe(false)
  })

  test("sends the push for an agent inbox once the bot is off", () => {
    expect(
      shouldSendIncomingMessagePush({
        conversation: bot(false, null),
        isExternalAgentInbox: true,
        now: NOW,
      }),
    ).toBe(true)
  })

  test("sends the push for an agent inbox during a bot pause still in the future", () => {
    expect(
      shouldSendIncomingMessagePush({
        conversation: bot(false, FUTURE),
        isExternalAgentInbox: true,
        now: NOW,
      }),
    ).toBe(true)
  })

  test("leaves the push unchanged for an inbox without an external agent", () => {
    expect(
      shouldSendIncomingMessagePush({
        conversation: bot(true, null),
        isExternalAgentInbox: false,
        now: NOW,
      }),
    ).toBe(true)
  })
})
