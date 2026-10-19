import type {
  ConnectionConfigField,
  ConnectionKind,
} from "@chatbotx.io/utils/connection"
import type { AuthValue } from "./auth"
import type { Handler } from "./shared"

/**
 * How a connection is established. Kept as an open string-literal union so a
 * future strategy (QR login, device code, OAuth1, "paste callback URL") is
 * additive — a new literal here plus a new `ConnectSessionNextAction.type`,
 * never a new table or a breaking change to `ConnectionProvider`.
 */
export type ConnectionStrategy =
  | "oauth_redirect"
  | "oauth_popup"
  | "token"
  | "api_key"
  | "self_serve"

export type {
  ConnectionConfigField,
  ConnectionKind,
  ConnectSessionNextAction,
} from "@chatbotx.io/utils/connection"

export type ConnectionHealth =
  | { ok: true; authExpiresAt?: string }
  | { ok: false; revoked: boolean; error: string }

/** Human-facing identity of a connected account, derived from its auth/profile data. */
export type ConnectionDescriptor = {
  sourceId: string
  displayName: string
  authExpiresAt?: string
  avatarUrl?: string
}

/** One selectable target surfaced by `listCandidates` during a connect session — carries auth, never persisted as-is. */
export type ConnectionCandidate<IAuth extends AuthValue = AuthValue> =
  ConnectionDescriptor & {
    alreadyConnected?: "this_workspace" | "other_workspace"
    auth: IAuth
  }

/** Opaque per-connection progress marker a polling provider round-trips. */
export type PollCursor = Record<string, unknown>

/** One inbound delivery, shaped exactly like the channel's webhook payload for `receiveMessage`. */
export type PollEvent = { payload: unknown }

export type PollResult = { events: PollEvent[]; cursor: PollCursor }

/**
 * Pull-based inbound delivery for channels without webhooks. The worker runs
 * `run` for `connected` connections only, at most once per `intervalSeconds`,
 * never two at a time for one connection, and persists `cursor` only after
 * every event was enqueued — so `run` must tolerate re-delivering events
 * (receivers dedupe on the message `sourceId`).
 */
export type ConnectionPoll<IAuth extends AuthValue> = {
  intervalSeconds: (auth: IAuth) => number
  run: Handler<{ auth: IAuth; cursor: PollCursor | null }, PollResult>
}

/** Provider-specific platform credential or direct connection input. */
export type ConnectionCredential = unknown

type ConnectionProviderCommon<IAuth extends AuthValue> = {
  kind: ConnectionKind
  configFields: readonly ConnectionConfigField[]
  describe: (auth: IAuth) => ConnectionDescriptor
  candidateToConfig?: (auth: IAuth) => Record<string, unknown>
  verify: Handler<{ auth: IAuth }, ConnectionHealth>
  isRevokedTokenError?: (error: unknown) => boolean
  webhook?: {
    subscribe: Handler<{ auth: IAuth }, void>
    unsubscribe: Handler<{ auth: IAuth }, void>
  }
  /**
   * Every connect lands in `paused` (reason `user_paused`) and skips
   * `webhook.subscribe`; the operator switches it on via `resume`. For
   * channels that must not start receiving until explicitly enabled.
   */
  startsPaused?: boolean
  /** Present for channels that receive by polling instead of a webhook. */
  poll?: ConnectionPoll<IAuth>
}

type OAuthStrategy<IAuth extends AuthValue, ICreds> = {
  strategy: Extract<ConnectionStrategy, "oauth_redirect" | "oauth_popup">
  authorizeUrl: (input: {
    credential: ICreds
    callbackUrl: string
    state: string
  }) => string
  exchangeCode: Handler<
    { code: string; callbackUrl: string; credential: ICreds },
    IAuth
  >
  fromCredentials?: never
}

type CredentialStrategy<IAuth extends AuthValue, ICreds> = {
  strategy: Extract<ConnectionStrategy, "token" | "api_key">
  authorizeUrl?: never
  exchangeCode?: never
  fromCredentials: Handler<ICreds, IAuth>
}

type SelfServeStrategy<IAuth extends AuthValue, ICreds> = {
  strategy: Extract<ConnectionStrategy, "self_serve">
  authorizeUrl?: never
  exchangeCode?: never
  fromCredentials?: Handler<ICreds, IAuth>
}

type MultiAccount<IAuth extends AuthValue> = {
  multiAccount: true
  listCandidates: Handler<{ auth: IAuth }, ConnectionCandidate<IAuth>[]>
}

type SingleAccount = {
  multiAccount: false
  listCandidates?: never
}

export type ConnectionProvider<
  IAuth extends AuthValue = AuthValue,
  ICreds = ConnectionCredential,
> = ConnectionProviderCommon<IAuth> &
  (
    | OAuthStrategy<IAuth, ICreds>
    | CredentialStrategy<IAuth, ICreds>
    | SelfServeStrategy<IAuth, ICreds>
  ) &
  (MultiAccount<IAuth> | SingleAccount)
