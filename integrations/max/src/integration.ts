import { randomBytes } from "node:crypto"
import {
  HandleRequestType,
  Integration,
  type IntegrationDefinition,
  probeVerify,
} from "@chatbotx.io/sdk"
import { getMe } from "./apis/bot"
import { subscribeWebhook, unsubscribeWebhook } from "./apis/subscriptions"
import { MaxAPIException } from "./exception"
import { conversationHandlers } from "./handlers/conversation"
import { messageHandlers } from "./handlers/message"
import { webhookHandler } from "./handlers/webhook"
import { isRevokedTokenError } from "./lib/error-mapper"
import { resolveMaxWebhookUrl } from "./lib/webhook-url"
import type { MaxAuthValue, MaxConfig } from "./schema"

const config: IntegrationDefinition<MaxConfig, MaxAuthValue> = {
  name: "max",
  channels: {
    channel: {
      message: messageHandlers,
      conversation: conversationHandlers,
    },
  },
  connection: {
    kind: "channel",
    strategy: "token",
    multiAccount: false,
    startsPaused: true,
    configFields: [{ name: "secretText", type: "secret", required: true }],
    describe: (auth) => ({ sourceId: auth.botId, displayName: auth.botName }),
    fromCredentials: async (input: { secretText: string }) => {
      const bot = await getMe(input.secretText)
      return {
        authType: "secretText",
        secretText: input.secretText,
        botId: String(bot.user_id),
        botName: bot.username ? `@${bot.username}` : (bot.name ?? "MAX bot"),
        webhookSecret: randomBytes(24).toString("hex"),
      }
    },
    verify: async ({ auth }) =>
      await probeVerify(() => getMe(auth.secretText), {
        label: "MAX bot token",
        isRevoked: isRevokedTokenError,
      }),
    isRevokedTokenError,
    webhook: {
      subscribe: async ({ auth }) => {
        await subscribeWebhook({
          token: auth.secretText,
          url: resolveMaxWebhookUrl(auth.botId),
          secret: auth.webhookSecret,
        })
      },
      unsubscribe: async ({ auth }) => {
        await unsubscribeWebhook({
          token: auth.secretText,
          url: resolveMaxWebhookUrl(auth.botId),
        })
      },
    },
  },
  actions: {},
  handleRequest: async (props) => {
    const action = new URL(props.req.url).pathname.split("/").pop()
    if (action === HandleRequestType.webhook) {
      return await webhookHandler(props)
    }
    throw new MaxAPIException(
      `${props.req.method} ${props.req.url} is not implemented`,
    )
  },
  disconnect: async (auth) => {
    await unsubscribeWebhook({
      token: auth.secretText,
      url: resolveMaxWebhookUrl(auth.botId),
    })
  },
}

export const integration = new Integration<
  IntegrationDefinition<MaxConfig, MaxAuthValue>
>(config)
