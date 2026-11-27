import { describe, expect, test } from "vitest"
import { parseRawMail, toSmtpInboundPayload } from "../src/inbound-mail"

const rawMail = [
  "From: Jane Doe <Jane@Example.com>",
  "To: support@example.com",
  "Subject: Need help",
  "Message-ID: <m1@example.com>",
  "In-Reply-To: <old@example.com>",
  "References: <old@example.com>",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hello team",
].join("\r\n")

describe("parseRawMail", () => {
  test("keeps the sender, subject and threading ids", async () => {
    const payload = await parseRawMail(
      Buffer.from(rawMail),
      new Set(["support@example.com"]),
      "<fallback@chatbotx>",
    )
    expect(payload).toMatchObject({
      messageId: "<m1@example.com>",
      fromAddress: "jane@example.com",
      fromName: "Jane Doe",
      subject: "Need help",
      inReplyTo: "<old@example.com>",
      references: ["<old@example.com>"],
    })
    expect(payload?.text).toContain("Subject: Need help")
    expect(payload?.text).toContain("Hello team")
  })

  test("skips delivery reports from mailer-daemon", async () => {
    const bounce = rawMail
      .replace(
        "Jane Doe <Jane@Example.com>",
        "Mail Delivery System <mailer-daemon@mail.gkamion.ru>",
      )
      .replace(
        "Subject: Need help",
        "Subject: Mail delivery failed: returning message to sender",
      )
    const payload = await parseRawMail(
      Buffer.from(bounce),
      new Set(["support@example.com"]),
      "<fallback@chatbotx>",
    )
    expect(payload).toBeNull()
  })

  test("skips mail sent from the connected mailbox", async () => {
    const payload = await parseRawMail(
      Buffer.from(rawMail),
      new Set(["jane@example.com"]),
      "<fallback@chatbotx>",
    )
    expect(payload).toBeNull()
  })

  test("uses the fallback id when the message has none", () => {
    const payload = toSmtpInboundPayload(
      {
        subject: "Hi",
        text: "Body",
        from: { value: [{ address: "a@b.co", name: "A" }] },
      },
      new Set(),
      "<fallback@chatbotx>",
    )
    expect(payload?.messageId).toBe("<fallback@chatbotx>")
  })
})
