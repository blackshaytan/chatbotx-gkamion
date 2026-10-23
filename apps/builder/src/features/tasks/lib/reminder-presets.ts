import { subDays, subHours, subMinutes } from "date-fns"

export const REMINDER_PRESETS = ["min15", "hour1", "day1"] as const

export type ReminderPreset = (typeof REMINDER_PRESETS)[number]

export const remindAtFromPreset = (
  dueAt: Date,
  preset: ReminderPreset,
): Date => {
  if (preset === "min15") {
    return subMinutes(dueAt, 15)
  }

  if (preset === "hour1") {
    return subHours(dueAt, 1)
  }

  return subDays(dueAt, 1)
}
