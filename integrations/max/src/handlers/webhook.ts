import type { HandleRequestProps } from "@chatbotx.io/sdk"
import { timingSafeStringEqual } from "@chatbotx.io/utils/crypto"
import { MAX_WEBHOOK_SECRET_HEADER } from "../constants"
import { MaxWebhookException } from "../exception"
import type { MaxConfig } from "../schema"
import { parseMaxUpdate } from "./parse-update"

export const webhookHandler = async (
  props: HandleRequestProps<MaxConfig>,
): Promise<string> => {
  const { req, config, queue } = props
  const presented = req.headers.get(MAX_WEBHOOK_SECRET_HEADER)
  if (
    !(
      config.webhookSecret &&
      presented &&
      timingSafeStringEqual(presented, config.webhookSecret)
    )
  ) {
    throw new MaxWebhookException("Invalid webhook secret")
  }
  const body = await req.text()
  if (!body) {
    throw new MaxWebhookException("Empty webhook payload")
  }
  const payload: unknown = JSON.parse(body)
  if (!parseMaxUpdate(payload)) {
    return "ok"
  }
  await queue?.add("incomingMessage", {
    type: "incomingMessage",
    data: {
      integrationType: "max",
      integrationIdentifier: config.botId ?? "",
      payload,
    },
  })
  return "ok"
}
