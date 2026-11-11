const MOSCOW_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

/**
 * ZZAP `message_date` format: Moscow wall time without an offset,
 * `YYYY-MM-DDTHH:mm:ss`. Strings in this format sort chronologically.
 */
export const formatMoscowDate = (date: Date): string =>
  MOSCOW_FORMATTER.format(date).replace(" ", "T")

const MOSCOW_WALL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

/**
 * Parses a ZZAP Moscow wall-time string back to a UTC `Date`.
 * Europe/Moscow is currently UTC+3 year-round; the offset is pinned to that.
 */
export const parseMoscowDate = (value: string): Date => {
  if (MOSCOW_WALL_RE.test(value)) {
    return new Date(`${value}+03:00`)
  }
  return new Date(value)
}
