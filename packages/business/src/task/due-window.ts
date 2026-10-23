import type { TaskDueFilter } from "@chatbotx.io/database/partials"
import { addDays, format, parseISO } from "date-fns"
import { formatInTimeZone, fromZonedTime } from "date-fns-tz"

export type TaskDueWindow = {
  dueFrom?: Date
  dueBefore?: Date
  withoutDue?: boolean
  /** Restrict to `todo` / `in_progress`. */
  openOnly?: boolean
}

const DAY_FORMAT = "yyyy-MM-dd"

const dayStartInZone = (day: string, timezone: string): Date =>
  fromZonedTime(`${day}T00:00:00`, timezone)

const shiftDay = (day: string, days: number): string =>
  format(addDays(parseISO(day), days), DAY_FORMAT)

export const resolveTaskDueWindow = (input: {
  due: TaskDueFilter
  now: Date
  timezone: string
}): TaskDueWindow => {
  const { due, now, timezone } = input
  if (due === "none") {
    return { withoutDue: true }
  }
  if (due === "overdue") {
    return { dueBefore: now, openOnly: true }
  }
  const today = formatInTimeZone(now, timezone, DAY_FORMAT)
  const length = due === "today" ? 1 : 7
  return {
    dueFrom: dayStartInZone(today, timezone),
    dueBefore: dayStartInZone(shiftDay(today, length), timezone),
  }
}
