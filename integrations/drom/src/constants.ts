export const DROM_BASE_URL = "https://baza.drom.ru"
/** DROM serves the seller chat only to a regular desktop browser. */
export const DROM_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
export const DROM_DEFAULT_REFERER = `${DROM_BASE_URL}/personal/messaging-modal?switchPosition=dialogs`
/** DROM publishes no limit; longer replies are split at line breaks. */
export const DROM_TEXT_LIMIT = 4000
export const DROM_MAX_IMAGES_PER_MESSAGE = 8
export const DROM_MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const DROM_REQUEST_TIMEOUT_MS = 45_000
export const DROM_UPLOAD_TIMEOUT_MS = 90_000
export const DROM_MIN_POLL_INTERVAL_SECONDS = 15

export const DROM_DEFAULTS = {
  pollIntervalSeconds: 30,
  maxDialogsPerPoll: 5,
  requestMinIntervalSeconds: 1,
} as const
