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
import { taskTabs } from "../schema/public"

export const taskStatusFilters = ["open", ...taskStatusValues] as const
export type { TaskTab } from "../schema/public"

export const useTaskSearchParams = () =>
  useQueryStates(
    {
      tab: parseAsStringLiteral(taskTabs.options).withDefault("mine"),
      status: parseAsStringLiteral(taskStatusFilters).withDefault("open"),
      priority: parseAsStringLiteral(["low", "normal", "high", "urgent"]),
      due: parseAsStringLiteral(taskDueFilters.options),
      contactId: parseAsString,
      conversationId: parseAsString,
      page: parseAsInteger.withDefault(1),
      perPage: parseAsInteger.withDefault(20),
      task: parseAsString,
    },
    { shallow: true, clearOnDefault: true },
  )
