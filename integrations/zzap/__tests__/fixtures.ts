import type { ZzapAuthValue } from "../src/schema"

export const ZZAP_BASE = "https://b52-api.zzap.pro/api/client/v1"

export const zzapAuth: ZzapAuthValue = {
  authType: "secretText",
  secretText: "test-api-key",
  codeObject: "42",
  typeObject: "1",
  testMode: false,
  pollIntervalSeconds: 180,
  maxThreadsPerPoll: 2,
  requestMinIntervalSeconds: 0,
}
