import { describe, expect, test, vi } from "vitest"
import { pollSmtpInbox } from "../src/handlers/poll"
import type { OpenedInbox } from "../src/imap"
import type { SmtpAuthValue } from "../src/schema"

const auth = {
  authType: "custom",
  provider: "google",
  host: "smtp.gmail.com",
  port: 587,
  username: "support@example.com",
  password: "secret",
  fromAddress: "Support <support@example.com>",
  receiveEnabled: true,
} satisfies SmtpAuthValue

const rawMail = [
  "From: Jane Doe <jane@example.com>",
  "To: support@example.com",
  "Subject: Need help",
  "Message-ID: <m1@example.com>",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hello",
].join("\r\n")

const openWith = (
  messages: { uid: number; source?: Buffer }[],
  uidNext = 11,
): OpenedInbox & { fetchSince: ReturnType<typeof vi.fn> } => {
  const fetchSince = vi.fn(async function* () {
    await Promise.resolve()
    for (const message of messages) {
      yield message
    }
  })
  return {
    uidValidity: 4,
    uidNext,
    fetchSince,
    close: vi.fn(async () => undefined),
  }
}

describe("pollSmtpInbox", () => {
  test("does not import mail that is already in the mailbox", async () => {
    const inbox = openWith([{ uid: 10, source: Buffer.from(rawMail) }])
    const openInbox = vi.fn(async () => inbox)
    const result = await pollSmtpInbox({ auth, cursor: null, openInbox })
    expect(inbox.fetchSince).not.toHaveBeenCalled()
    expect(result).toEqual({
      events: [],
      cursor: { uidValidity: 4, lastUid: 10 },
    })
  })

  test("enqueues mail that arrived after the cursor and skips our own copy", async () => {
    const own = rawMail.replace("jane@example.com", "support@example.com")
    const inbox = openWith([
      { uid: 10, source: Buffer.from(own) },
      { uid: 11, source: Buffer.from(rawMail) },
    ])
    const result = await pollSmtpInbox({
      auth,
      cursor: { uidValidity: 4, lastUid: 9 },
      openInbox: async () => inbox,
    })
    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.payload).toMatchObject({
      fromAddress: "jane@example.com",
      messageId: "<m1@example.com>",
    })
    expect(result.cursor).toEqual({ uidValidity: 4, lastUid: 11 })
  })

  test("resets the cursor when the mailbox uid validity changes", async () => {
    const inbox = openWith([], 3)
    inbox.uidValidity = 9
    const result = await pollSmtpInbox({
      auth,
      cursor: { uidValidity: 4, lastUid: 1 },
      openInbox: async () => inbox,
    })
    expect(inbox.fetchSince).not.toHaveBeenCalled()
    expect(result.cursor).toEqual({ uidValidity: 9, lastUid: 2 })
  })

  test("skips a message larger than 8MB and still advances the cursor", async () => {
    const inbox = openWith([
      { uid: 10, source: Buffer.alloc(8_000_001) },
      { uid: 11, source: Buffer.from(rawMail) },
    ])
    const result = await pollSmtpInbox({
      auth,
      cursor: { uidValidity: 4, lastUid: 9 },
      openInbox: async () => inbox,
    })
    expect(result.events).toHaveLength(1)
    expect(result.cursor).toEqual({ uidValidity: 4, lastUid: 11 })
  })

  test("does not connect for a send-only provider", async () => {
    const openInbox = vi.fn()
    const result = await pollSmtpInbox({
      auth: { ...auth, provider: "sendgrid", receiveEnabled: true },
      cursor: null,
      openInbox,
    })
    expect(openInbox).not.toHaveBeenCalled()
    expect(result.events).toEqual([])
  })
})
