import {
  Integration,
  type IntegrationDefinition,
  probeVerify,
} from "@chatbotx.io/sdk"
import { getInboxConfig } from "./apis/inbox"
import { DROM_DEFAULTS, DROM_MIN_POLL_INTERVAL_SECONDS } from "./constants"
import { DromAPIException } from "./exception"
import { messageHandlers } from "./handlers/message"
import { pollDrom } from "./handlers/poll"
import { toCookieHeader } from "./lib/cookies"
import { isRevokedTokenError } from "./lib/error-mapper"
import type { DromAuthValue, DromConfig, DromCredentialsInput } from "./schema"

export const toDromAuth = (input: DromCredentialsInput): DromAuthValue => ({
  authType: "secretText",
  secretText: toCookieHeader(input.secretText),
  sellerLogin: String(input.sellerLogin).trim(),
  pollIntervalSeconds: Math.max(
    DROM_MIN_POLL_INTERVAL_SECONDS,
    input.pollIntervalSeconds ?? DROM_DEFAULTS.pollIntervalSeconds,
  ),
  maxDialogsPerPoll: Math.max(
    1,
    input.maxDialogsPerPoll ?? DROM_DEFAULTS.maxDialogsPerPoll,
  ),
  requestMinIntervalSeconds: Math.max(
    0,
    input.requestMinIntervalSeconds ?? DROM_DEFAULTS.requestMinIntervalSeconds,
  ),
})

const config: IntegrationDefinition<DromConfig, DromAuthValue> = {
  name: "drom",
  channels: {
    channel: {
      message: messageHandlers,
    },
  },
  connection: {
    kind: "channel",
    strategy: "token",
    multiAccount: false,
    startsPaused: true,
    configFields: [
      { name: "secretText", type: "secret", required: true },
      { name: "sellerLogin", type: "string", required: true },
      { name: "pollIntervalSeconds", type: "number", required: false },
      { name: "maxDialogsPerPoll", type: "number", required: false },
      { name: "requestMinIntervalSeconds", type: "number", required: false },
    ],
    describe: (auth) => ({
      sourceId: auth.sellerLogin,
      displayName: `DROM ${auth.sellerLogin}`,
    }),
    fromCredentials: async (input: DromCredentialsInput) => {
      const auth = toDromAuth(input)
      await getInboxConfig(auth)
      return auth
    },
    verify: async ({ auth }) =>
      await probeVerify(() => getInboxConfig(auth), {
        label: "DROM cookies",
        isRevoked: isRevokedTokenError,
      }),
    isRevokedTokenError,
    poll: {
      intervalSeconds: (auth) => auth.pollIntervalSeconds,
      run: async ({ auth, cursor }) => await pollDrom({ auth, cursor }),
    },
  },
  actions: {},
  handleRequest: (props) => {
    throw new DromAPIException(
      `${props.req.method} ${props.req.url} is not implemented`,
    )
  },
  disconnect: async () => undefined,
}

export const integration = new Integration<
  IntegrationDefinition<DromConfig, DromAuthValue>
>(config)
