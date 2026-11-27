// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"

const { conversationService } = await import("../src/conversation/service")
const { contactInboxService } = await import("../src/contact-inbox/service")
const { contactService } = await import("../src/contact")
const smtpOwnership = await import("../src/inbox/smtp-ownership")
const { ChatbotXException } = await import("../src/errors")

describe("conversationService.listReplyChannels", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test("lists visible contact inboxes and adds a bootstrap email option", async () => {
    vi.spyOn(conversationService, "findByOrFail").mockResolvedValue({
      id: "conv-1",
      contactId: "contact-1",
      workspaceId: "ws-1",
    } as never)
    vi.spyOn(contactInboxService, "listByContactId").mockResolvedValue([
      {
        id: "ci-wa",
        inboxId: "inbox-wa",
        channel: "whatsapp",
        lastMessageAt: new Date("2024-06-01"),
      },
      {
        id: "ci-hidden",
        inboxId: "inbox-hidden",
        channel: "smtp",
        lastMessageAt: new Date("2024-07-01"),
      },
    ] as never)
    vi.spyOn(contactInboxService, "findRecentByContactId").mockResolvedValue({
      id: "ci-wa",
      inboxId: "inbox-wa",
      channel: "whatsapp",
    } as never)
    vi.spyOn(contactService, "findBy").mockResolvedValue({
      id: "contact-1",
      email: "client@example.com",
    } as never)
    vi.spyOn(smtpOwnership, "resolveSmtpReplyInbox").mockResolvedValue({
      id: "inbox-smtp",
      name: "Support",
    })

    // Avoid hitting the real DB for inbox names.
    const dbModule = await import("@chatbotx.io/database/client")
    vi.spyOn(dbModule.db.query.inboxModel, "findMany").mockResolvedValue([
      { id: "inbox-wa", name: "WA Page" },
    ] as never)

    const result = await conversationService.listReplyChannels({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      viewerUserId: "u1",
      hiddenInboxIds: ["inbox-hidden"],
    })

    expect(result.options).toEqual([
      {
        inboxId: "inbox-wa",
        channel: "whatsapp",
        name: "WA Page",
        needsBootstrap: false,
      },
      {
        inboxId: "inbox-smtp",
        channel: "smtp",
        name: "Support",
        needsBootstrap: true,
      },
    ])
    expect(result.defaultInboxId).toBe("inbox-wa")
  })

  test("does not add a bootstrap email option when a visible SMTP ContactInbox exists", async () => {
    vi.spyOn(conversationService, "findByOrFail").mockResolvedValue({
      id: "conv-1",
      contactId: "contact-1",
      workspaceId: "ws-1",
    } as never)
    vi.spyOn(contactInboxService, "listByContactId").mockResolvedValue([
      {
        id: "ci-smtp",
        inboxId: "inbox-smtp",
        channel: "smtp",
        lastMessageAt: new Date("2024-06-01"),
      },
    ] as never)
    vi.spyOn(contactInboxService, "findRecentByContactId").mockResolvedValue({
      id: "ci-smtp",
      inboxId: "inbox-smtp",
      channel: "smtp",
    } as never)
    const findContact = vi.spyOn(contactService, "findBy")
    const resolveSmtp = vi.spyOn(smtpOwnership, "resolveSmtpReplyInbox")
    const dbModule = await import("@chatbotx.io/database/client")
    vi.spyOn(dbModule.db.query.inboxModel, "findMany").mockResolvedValue([
      { id: "inbox-smtp", name: "Mail" },
    ] as never)

    const result = await conversationService.listReplyChannels({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      viewerUserId: "u1",
    })

    expect(result.options).toEqual([
      {
        inboxId: "inbox-smtp",
        channel: "smtp",
        name: "Mail",
        needsBootstrap: false,
      },
    ])
    expect(findContact).not.toHaveBeenCalled()
    expect(resolveSmtp).not.toHaveBeenCalled()
  })

  test("does not list a non-SMTP channel that has no ContactInbox", async () => {
    vi.spyOn(conversationService, "findByOrFail").mockResolvedValue({
      id: "conv-1",
      contactId: "contact-1",
      workspaceId: "ws-1",
    } as never)
    vi.spyOn(contactInboxService, "listByContactId").mockResolvedValue(
      [] as never,
    )
    vi.spyOn(contactInboxService, "findRecentByContactId").mockResolvedValue(
      undefined,
    )
    vi.spyOn(contactService, "findBy").mockResolvedValue({
      id: "contact-1",
      email: null,
    } as never)

    const result = await conversationService.listReplyChannels({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      viewerUserId: "u1",
    })

    expect(result.options).toEqual([])
    expect(result.defaultInboxId).toBeNull()
  })
})

describe("conversationService.resolveContactInboxForConversation bootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test("bootstraps SMTP when inboxId matches the server target", async () => {
    vi.spyOn(contactInboxService, "findBy").mockResolvedValue(undefined)
    vi.spyOn(smtpOwnership, "resolveSmtpReplyInbox").mockResolvedValue({
      id: "inbox-smtp",
      name: "Support",
    })
    vi.spyOn(contactService, "findBy").mockResolvedValue({
      id: "contact-1",
      email: "Client@Example.com",
    } as never)
    const connect = vi
      .spyOn(contactInboxService, "connectExistingContact")
      .mockResolvedValue({
        id: "ci-new",
        inboxId: "inbox-smtp",
        channel: "smtp",
        sourceId: "client@example.com",
      } as never)

    const result = await conversationService.resolveContactInboxForConversation(
      {
        conversation: { contactId: "contact-1" },
        workspaceId: "ws-1",
        inboxId: "inbox-smtp",
        viewerUserId: "u1",
      },
    )

    expect(result.id).toBe("ci-new")
    expect(connect).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      contactId: "contact-1",
      inboxId: "inbox-smtp",
      channel: "smtp",
      sourceId: "client@example.com",
    })
  })

  test("rejects a forged inboxId that is not the server SMTP target", async () => {
    vi.spyOn(contactInboxService, "findBy").mockResolvedValue(undefined)
    vi.spyOn(smtpOwnership, "resolveSmtpReplyInbox").mockResolvedValue({
      id: "inbox-smtp",
      name: "Support",
    })

    await expect(
      conversationService.resolveContactInboxForConversation({
        conversation: { contactId: "contact-1" },
        workspaceId: "ws-1",
        inboxId: "forged-personal",
        viewerUserId: "u1",
      }),
    ).rejects.toMatchObject({ code: "notFound" })
  })

  test("throws validation when the email already belongs to another contact", async () => {
    vi.spyOn(contactInboxService, "findBy").mockResolvedValue(undefined)
    vi.spyOn(smtpOwnership, "resolveSmtpReplyInbox").mockResolvedValue({
      id: "inbox-smtp",
      name: "Support",
    })
    vi.spyOn(contactService, "findBy").mockResolvedValue({
      id: "contact-1",
      email: "taken@example.com",
    } as never)
    vi.spyOn(contactInboxService, "connectExistingContact").mockResolvedValue(
      null,
    )

    await expect(
      conversationService.resolveContactInboxForConversation({
        conversation: { contactId: "contact-1" },
        workspaceId: "ws-1",
        inboxId: "inbox-smtp",
        viewerUserId: "u1",
      }),
    ).rejects.toBeInstanceOf(ChatbotXException)

    await expect(
      conversationService.resolveContactInboxForConversation({
        conversation: { contactId: "contact-1" },
        workspaceId: "ws-1",
        inboxId: "inbox-smtp",
        viewerUserId: "u1",
      }),
    ).rejects.toMatchObject({
      code: "validation",
      field: "inboxId",
    })
  })
})
