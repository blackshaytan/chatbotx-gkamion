import z from "zod"

export const TASK_LIMITS = {
  maxTitleLength: 255,
  maxDescriptionLength: 10_000,
  maxCommentLength: 10_000,
  maxWatchers: 50,
} as const

export const CHAT_LIMITS = {
  maxMessageLength: TASK_LIMITS.maxCommentLength,
  defaultPageSize: 50,
  maxPageSize: 50,
} as const

export const taskStatusValues = [
  "todo",
  "in_progress",
  "done",
  "canceled",
] as const
export const taskStatuses = z.enum(taskStatusValues)
export type TaskStatus = z.infer<typeof taskStatuses>

export const OPEN_TASK_STATUSES = [
  "todo",
  "in_progress",
] as const satisfies readonly TaskStatus[]

// Declared low → urgent: Postgres orders enum values by declaration, so a
// DESC sort on the column puts urgent first.
export const taskPriorityValues = ["low", "normal", "high", "urgent"] as const
export const taskPriorities = z.enum(taskPriorityValues)
export type TaskPriority = z.infer<typeof taskPriorities>

export const taskCreatedBySourceValues = ["user", "flow", "api"] as const
export const taskCreatedBySources = z.enum(taskCreatedBySourceValues)
export type TaskCreatedBySource = z.infer<typeof taskCreatedBySources>

export const internalThreadTypeValues = ["task", "direct", "agent"] as const

export const CHAT_THREAD_TYPES = ["direct", "agent"] as const
export type ChatThreadType = (typeof CHAT_THREAD_TYPES)[number]

export const internalMessageKindValues = ["comment", "system"] as const
export const internalMessageKinds = z.enum(internalMessageKindValues)
export type InternalMessageKind = z.infer<typeof internalMessageKinds>

export const taskDueFilters = z.enum(["overdue", "today", "week", "none"])
export type TaskDueFilter = z.infer<typeof taskDueFilters>

export const taskSystemEventTypes = z.enum([
  "created",
  "status",
  "due",
  "assignee",
  "priority",
])

/** `from`/`to` are status/priority values, ISO dates, or `user:<id>` / `team:<id>`. */
export type TaskSystemEvent = {
  type: z.infer<typeof taskSystemEventTypes>
  from: string | null
  to: string | null
  byUserId: string | null
}

export type InternalMessageMentions = { userIds: string[]; teamIds: string[] }

export const EMPTY_INTERNAL_MESSAGE_MENTIONS: InternalMessageMentions = {
  userIds: [],
  teamIds: [],
}

export type InternalMessageAttachment = {
  key: string
  name: string
  size: number
  mimeType: string
}
