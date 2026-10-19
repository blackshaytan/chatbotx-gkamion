export const ZZAP_API_BASE_URL = "https://b52-api.zzap.pro"
export const ZZAP_API_KEY_HEADER = "zzap-api-key"
export const ZZAP_TEXT_LIMIT = 4000
/** ZZAP throttles hard below ~3 s between calls of one key. */
export const ZZAP_MIN_REQUEST_INTERVAL_SECONDS = 3
export const ZZAP_429_MAX_RETRIES = 3
export const ZZAP_REQUEST_TIMEOUT_MS = 45_000

export const ZZAP_DEFAULTS = {
  pollIntervalSeconds: 180,
  maxThreadsPerPoll: 5,
  requestMinIntervalSeconds: 3.5,
} as const

/** Hosts ZZAP serves chat attachments from; anything else is never fetched. */
export const ZZAP_FILE_HOSTS = [
  "koj.blob.core.windows.net",
  "zzap.ru",
  "zzap.pro",
] as const
