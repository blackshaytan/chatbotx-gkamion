import { format, isSameDay, isSameYear } from "date-fns"

const TIME_OF_DAY_FORMAT = "HH:mm"
const DAY_MONTH_TIME_FORMAT = "dd.MM HH:mm"
const FULL_DATE_TIME_FORMAT = "dd.MM.yyyy HH:mm"

/**
 * Short time shown inside a message bubble, relative to `now`: `HH:mm` for a
 * message from today, `dd.MM HH:mm` from the same year, `dd.MM.yyyy HH:mm`
 * for anything older. Uses the viewer's local time zone.
 */
export const formatMessageTime = (createdAt: Date, now: Date): string => {
  if (isSameDay(createdAt, now)) {
    return format(createdAt, TIME_OF_DAY_FORMAT)
  }
  if (isSameYear(createdAt, now)) {
    return format(createdAt, DAY_MONTH_TIME_FORMAT)
  }
  return format(createdAt, FULL_DATE_TIME_FORMAT)
}
