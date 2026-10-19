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
