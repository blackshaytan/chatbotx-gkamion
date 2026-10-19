import type { HandleRequestProps } from "@chatbotx.io/sdk"
import { describe, expect, test, vi } from "vitest"
import { MAX_WEBHOOK_SECRET_HEADER } from "../src/constants"
import { MaxWebhookException } from "../src/exception"
import { webhookHandler } from "../src/handlers/webhook"
import type { MaxConfig } from "../src/schema"
import group from "./fixtures/message-group.json"
import text from "./fixtures/message-text.json"

const buildProps = (payload: unknown, secret?: string) => {
  const add = vi.fn()
  const headers = new Headers({ "content-type": "application/json" })
  if (secret) {
    headers.set(MAX_WEBHOOK_SECRET_HEADER, secret)
  }
  const props = {
    req: new Request("https://builder.test/integrations/max/webhook", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
    config: { botId: "777", webhookSecret: "s" },
    queue: { add },
  } as unknown as HandleRequestProps<MaxConfig>
  return { props, add }
}

describe("max webhookHandler", () => {
  test("rejects a request without the webhook secret", async () => {
    const { props, add } = buildProps(text)

    await expect(webhookHandler(props)).rejects.toBeInstanceOf(
      MaxWebhookException,
    )
    expect(add).not.toHaveBeenCalled()
  })

  test("rejects a wrong webhook secret", async () => {
    const { props, add } = buildProps(text, "wrong")

    await expect(webhookHandler(props)).rejects.toBeInstanceOf(
      MaxWebhookException,
    )
    expect(add).not.toHaveBeenCalled()
  })

  test("queues a direct message", async () => {
    const { props, add } = buildProps(text, "s")

    await expect(webhookHandler(props)).resolves.toBe("ok")
    expect(add).toHaveBeenCalledWith("incomingMessage", {
      type: "incomingMessage",
      data: {
        integrationType: "max",
        integrationIdentifier: "777",
        payload: text,
      },
    })
  })

  test("drops group traffic", async () => {
    const { props, add } = buildProps(group, "s")

    await expect(webhookHandler(props)).resolves.toBe("ok")
    expect(add).not.toHaveBeenCalled()
  })
})
