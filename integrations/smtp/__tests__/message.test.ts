import { ChannelError } from "@chatbotx.io/sdk"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { SmtpAuthValue } from "../src/schema"

const sendMail = vi.hoisted(() =>
  vi.fn(async () => ({ messageId: "<out@example.com>" })),
)

vi.mock("../src/actions", () => ({
  sendMail,
}))

const { receiveMessage } = await import("../src/handlers/message/incoming")
const { sendMessage } = await import("../src/handlers/message/outgoing")

const auth = {
  authType: "custom",
  provider: "google",
  host: "smtp.gmail.com",
  port: 587,
  username: "support@example.com",
  password: "secret",
  fromAddress: "Support <support@example.com>",
} satisfies SmtpAuthValue

const ctx = {
  auth,
  storagePrefix: "prefix",
  platform: {} as never,
  integrationDetail: { fromAddress: "Support <support@example.com>" },
  uploader: { putObject: vi.fn(async () => undefined) },
}

beforeEach(() => {
  sendMail.mockClear()
  ctx.uploader.putObject.mockClear()
})

describe("receiveMessage", () => {
  test("turns a parsed mail into a contact keyed by email", async () => {
    const result = await receiveMessage({
      ctx,
      data: {
        integrationType: "smtp",
        integrationIdentifier: "smtp-1",
        payload: {
          messageId: "<m1@example.com>",
          fromAddress: "jane@example.com",
          fromName: "Jane Doe",
          subject: "Need help",
          text: "Subject: Need help\n\nHello",
          references: ["<old@example.com>"],
        },
      },
    })
    expect(result.contact).toMatchObject({
      sourceId: "jane@example.com",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
    })
    expect(result.message).toMatchObject({
      sourceId: "<m1@example.com>",
      messageType: "incoming",
      text: "Subject: Need help\n\nHello",
      contentAttributes: {
        email: {
          subject: "Need help",
          messageId: "<m1@example.com>",
          references: ["<old@example.com>"],
        },
      },
    })
  })

  test("rejects a malformed poll event", async () => {
    await expect(
      receiveMessage({
        ctx,
        data: {
          integrationType: "smtp",
          integrationIdentifier: "smtp-1",
          payload: { text: "no sender" },
        },
      }),
    ).rejects.toBeInstanceOf(ChannelError)
  })
})

describe("sendMessage", () => {
  test("replies on the same thread", async () => {
    const result = await sendMessage({
      ctx,
      data: {
        contact: { sourceId: "Jane@Example.com", id: "contact-inbox-1" },
        message: {
          id: "message-1",
          workspaceId: "workspace-1",
          conversationId: "conversation-1",
          contentType: "text",
          text: "We can help",
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
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Support <support@example.com>",
        to: "jane@example.com",
        subject: "Re: Need help",
        text: "We can help",
        inReplyTo: "<m1@example.com>",
        references: "<old@example.com> <m1@example.com>",
      }),
    )
  })

  test("refuses a contact that is not an email address", async () => {
    await expect(
      sendMessage({
        ctx,
        data: {
          contact: { sourceId: "not-an-email", id: "contact-inbox-1" },
          message: {
            id: "message-1",
            workspaceId: "workspace-1",
            conversationId: "conversation-1",
            contentType: "text",
            text: "Hi",
            messageType: "outgoing",
          },
        },
      }),
    ).rejects.toBeInstanceOf(ChannelError)
    expect(sendMail).not.toHaveBeenCalled()
  })
})
