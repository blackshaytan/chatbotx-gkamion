import type { BaseConfig, SecretTextAuthValue } from "@chatbotx.io/sdk"

/**
 * `secretText` is the B52 API key. Everything else is shop configuration —
 * kept in the same sealed envelope so there is a single storage path.
 */
export type ZzapAuthValue = SecretTextAuthValue & {
  codeObject: string
  typeObject: string
  /** Sends with `test=true`: ZZAP accepts the reply but does not deliver it. */
  testMode: boolean
  pollIntervalSeconds: number
  maxThreadsPerPoll: number
  requestMinIntervalSeconds: number
}

export type ZzapCredentialsInput = {
  secretText: string
  codeObject: string
  typeObject: string
  testMode?: boolean
  pollIntervalSeconds?: number
  maxThreadsPerPoll?: number
  requestMinIntervalSeconds?: number
}

export type ZzapConfig = BaseConfig & { codeObject?: string }

export type ZzapThread = {
  user_key: string
  user_name?: string
  message_last?: string
  message_last_date?: string
  unread_count?: number
  read_only?: boolean
}

export type ZzapMessage = {
  user_key: string
  user_name?: string
  message: string
  message_date: string
}

export type ZzapBuyer = { name?: string; phone?: string; email?: string }
