/**
 * Client-facing text confirming that a conversation was handed over to a
 * manager. The confirmation is platform-owned — after a handover the agent's
 * own final reply is suppressed, so both confirmation paths (the handover
 * enqueue and the failure-to-human fallback) resolve the text here.
 *
 * The wording follows the Moscow working time of the pickup point:
 * Mon–Fri 10:00–19:00, Sat 12:00–16:00, Sun closed. Inside the window the
 * client gets the plain confirmation; outside it the client is told the point
 * is closed and the manager will reply during working hours.
 */

export const EXTERNAL_AGENT_HANDOVER_OPEN_TEXT =
  "Я передала ваш запрос менеджеру"

export const EXTERNAL_AGENT_HANDOVER_CLOSED_TEXT =
  "Сейчас нерабочее время пункта выдачи. График по Москве: Пн–Пт 10:00–19:00, Сб 12:00–16:00, Вс — выходной. Я уже передала ваш запрос менеджеру. Менеджер ответит вам в рабочее время."

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** Moscow is a fixed UTC+03:00 zone — Russia has had no daylight saving time since 2014. */
const MOSCOW_OFFSET_MS = 3 * HOUR_MS
/** 1970-01-01 was a Thursday, so `(days + 4) % 7` is the weekday, where 0 = Sunday. */
const EPOCH_WEEKDAY_OFFSET = 4
/** Working window in hours from Moscow midnight per weekday; Sunday (0) is closed. */
const OPEN_RANGE_BY_WEEKDAY: Partial<
  Record<number, readonly [openHour: number, closeHour: number]>
> = {
  1: [10, 19],
  2: [10, 19],
  3: [10, 19],
  4: [10, 19],
  5: [10, 19],
  6: [12, 16],
}

/** `time >= open && time < close` in Moscow, on the day's weekday schedule. */
export const isExternalAgentHandoverWindowOpen = (now: Date): boolean => {
  const shifted = now.getTime() + MOSCOW_OFFSET_MS
  const weekday =
    (((Math.floor(shifted / DAY_MS) + EPOCH_WEEKDAY_OFFSET) % 7) + 7) % 7
  const openRange = OPEN_RANGE_BY_WEEKDAY[weekday]
  if (!openRange) {
    return false
  }
  const msOfDay = ((shifted % DAY_MS) + DAY_MS) % DAY_MS
  return msOfDay >= openRange[0] * HOUR_MS && msOfDay < openRange[1] * HOUR_MS
}

export const resolveExternalAgentHandoverClientText = (now: Date): string =>
  isExternalAgentHandoverWindowOpen(now)
    ? EXTERNAL_AGENT_HANDOVER_OPEN_TEXT
    : EXTERNAL_AGENT_HANDOVER_CLOSED_TEXT
