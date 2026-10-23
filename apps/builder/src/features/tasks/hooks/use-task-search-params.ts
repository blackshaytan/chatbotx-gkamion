"use client"

import {
  taskDueFilters,
  taskStatusValues,
} from "@chatbotx.io/database/partials"
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs"

export const taskTabs = [
  "mine",
  "createdByMe",
  "watching",
  "myTeams",
  "all",
] as const
export const taskStatusFilters = ["open", ...taskStatusValues] as const

export const useTaskSearchParams = () =>
  useQueryStates(
    {
      tab: parseAsStringLiteral(taskTabs).withDefault("mine"),
      status: parseAsStringLiteral(taskStatusFilters).withDefault("open"),
      priority: parseAsStringLiteral(["low", "normal", "high", "urgent"]),
      due: parseAsStringLiteral(taskDueFilters.options),
      contactId: parseAsString,
      conversationId: parseAsString,
      page: parseAsInteger.withDefault(1),
      task: parseAsString,
    },
    { shallow: false, clearOnDefault: true },
  )
