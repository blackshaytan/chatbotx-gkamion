import {
  Integration,
  type IntegrationDefinition,
  probeVerify,
} from "@chatbotx.io/sdk"
import { listThreads } from "./apis/threads"
import { ZZAP_DEFAULTS, ZZAP_MIN_REQUEST_INTERVAL_SECONDS } from "./constants"
import { ZzapAPIException } from "./exception"
import { messageHandlers } from "./handlers/message"
import { pollZzap } from "./handlers/poll"
import { isRevokedTokenError } from "./lib/error-mapper"
import type { ZzapAuthValue, ZzapConfig, ZzapCredentialsInput } from "./schema"

export const toZzapAuth = (input: ZzapCredentialsInput): ZzapAuthValue => ({
  authType: "secretText",
  secretText: input.secretText.trim(),
  codeObject: String(input.codeObject).trim(),
  typeObject: String(input.typeObject).trim(),
  testMode: input.testMode ?? false,
  pollIntervalSeconds:
    input.pollIntervalSeconds ?? ZZAP_DEFAULTS.pollIntervalSeconds,
  maxThreadsPerPoll: Math.max(
    1,
    input.maxThreadsPerPoll ?? ZZAP_DEFAULTS.maxThreadsPerPoll,
  ),
  requestMinIntervalSeconds: Math.max(
    ZZAP_MIN_REQUEST_INTERVAL_SECONDS,
    input.requestMinIntervalSeconds ?? ZZAP_DEFAULTS.requestMinIntervalSeconds,
  ),
})

const probe = (auth: ZzapAuthValue) => listThreads(auth, { pageSize: 1 })

const config: IntegrationDefinition<ZzapConfig, ZzapAuthValue> = {
  name: "zzap",
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
      { name: "codeObject", type: "string", required: true },
      { name: "typeObject", type: "string", required: true },
      { name: "testMode", type: "boolean", required: false },
      { name: "pollIntervalSeconds", type: "number", required: false },
      { name: "maxThreadsPerPoll", type: "number", required: false },
      { name: "requestMinIntervalSeconds", type: "number", required: false },
    ],
    describe: (auth) => ({
      sourceId: auth.codeObject,
      displayName: `ZZAP ${auth.codeObject}`,
    }),
    fromCredentials: async (input: ZzapCredentialsInput) => {
      const auth = toZzapAuth(input)
      await probe(auth)
      return auth
    },
    verify: async ({ auth }) =>
      await probeVerify(() => probe(auth), {
        label: "ZZAP API key",
        isRevoked: isRevokedTokenError,
      }),
    isRevokedTokenError,
    poll: {
      intervalSeconds: (auth) => auth.pollIntervalSeconds,
      run: async ({ auth, cursor }) => await pollZzap({ auth, cursor }),
    },
  },
  actions: {},
  handleRequest: (props) => {
    throw new ZzapAPIException(
      `${props.req.method} ${props.req.url} is not implemented`,
    )
  },
  disconnect: async () => undefined,
}

export const integration = new Integration<
  IntegrationDefinition<ZzapConfig, ZzapAuthValue>
>(config)
