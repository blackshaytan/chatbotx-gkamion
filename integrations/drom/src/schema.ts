import type { BaseConfig, SecretTextAuthValue } from "@chatbotx.io/sdk"

/**
 * `secretText` is the seller's `Cookie` header. DROM has no API: the channel
 * drives the seller web chat with that browser session.
 */
export type DromAuthValue = SecretTextAuthValue & {
  sellerLogin: string
  pollIntervalSeconds: number
  maxDialogsPerPoll: number
  requestMinIntervalSeconds: number
}

export type DromCredentialsInput = {
  secretText: string
  sellerLogin: string
  pollIntervalSeconds?: number
  maxDialogsPerPoll?: number
  requestMinIntervalSeconds?: number
}

export type DromConfig = BaseConfig
