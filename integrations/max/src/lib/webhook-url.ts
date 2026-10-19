import { MaxException } from "../exception"

/** Public URL MAX posts updates to; same origin rule as the builder's broker callbacks. */
export const resolveMaxWebhookUrl = (botId: string): string => {
  const origin =
    process.env.NEXT_PUBLIC_BROKER_URL ?? process.env.NEXT_PUBLIC_BUILDER_URL
  if (!origin) {
    throw new MaxException("NEXT_PUBLIC_BUILDER_URL is not configured")
  }
  const url = new URL("/integrations/max/webhook", origin)
  url.searchParams.set("botId", botId)
  return url.toString()
}
