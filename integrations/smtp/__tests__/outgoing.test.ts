import { beforeEach, describe, expect, test, vi } from "vitest"

const sendMailMock = vi.hoisted(() => vi.fn())

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: sendMailMock,
    }),
  },
}))

const { sendMessage } = await import("../src/handlers/message/outgoing")

const ctx = {
  auth: {
    authType: "custom" as const,
    provider: "google" as const,
    host: "smtp.gmail.com",
    port: 587,
    username: "support@example.com",
    password: "secret",
  },
  storagePrefix: "mail",
  integrationDetail: { fromAddress: "Support <support@example.com>" },
  platform: {},
}

describe("smtp sendMessage", () => {
  beforeEach(() => {
    sendMailMock.mockReset()
    sendMailMock.mockResolvedValue({ messageId: "<out@example.com>" })
  })

  test("replies in the same thread", async () => {
    const result = await sendMessage({
      ctx: ctx as never,
      data: {
        contact: { sourceId: "Jane@Example.com", id: "c1" },
        message: {
          id: "m1",
          workspaceId: "w1",
          contentType: "text",
          text: "We are on it",
          messageType: "outgoing",
          contentAttributes: {
            emailReply: {
              subject: "Need help",
              inReplyTo: "<m1@example.com>",
              references: "<old@example.com> <m1@example.com>",
            },
          },
        },
      },
    })

    expect(result).toEqual({
      messageIds: ["<out@example.com>"],
      sentCount: 1,
    })
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Support <support@example.com>",
        to: "jane@example.com",
        subject: "Re: Need help",
        inReplyTo: "<m1@example.com>",
        references: "<old@example.com> <m1@example.com>",
        text: "We are on it",
      }),
    )
  })
})
