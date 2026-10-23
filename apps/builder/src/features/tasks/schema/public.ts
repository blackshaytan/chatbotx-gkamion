import {
  internalMessageKinds,
  TASK_LIMITS,
  taskCreatedBySources,
  taskDueFilters,
  taskPriorities,
  taskStatuses,
  taskStatusValues,
  taskSystemEventTypes,
} from "@chatbotx.io/database/partials"
import { zodBigintAsString } from "@chatbotx.io/utils"
import z from "zod"
import { publicListResponse, withPublicPaging } from "@/lib/public-api/list"

const taskId = zodBigintAsString().describe(
  "Task id. Get it from `tasks.list` or `tasks.create`.",
)
const userId = (what: string) =>
  zodBigintAsString().describe(
    `${what} Get user ids from \`workspaceMembers.list\` (\`userId\`).`,
  )
const teamId = zodBigintAsString().describe(
  "Team id. Get it from `inboxTeams.list`.",
)

export const taskIdPathParam = z.object({ id: taskId })

const taskTargetResource = z.object({
  type: z.enum(["contact", "conversation", "message"]),
  id: z
    .string()
    .nullable()
    .describe("Linked contact, conversation or message id; null when hidden."),
  hidden: z
    .boolean()
    .describe("True when the caller may not see this contact or conversation."),
  label: z
    .string()
    .nullable()
    .describe("Contact name for a visible contact link; otherwise null."),
})

export const taskPublicResource = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatuses,
  priority: taskPriorities,
  dueAt: z.date().nullable(),
  remindAt: z.date().nullable(),
  assigneeUserId: z.string().nullable(),
  assigneeTeamId: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  createdBySource: taskCreatedBySources,
  createdByLabel: z
    .string()
    .nullable()
    .describe("API token or flow name when no person created the task."),
  watcherUserIds: z.array(z.string()),
  targets: z.array(taskTargetResource),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  url: z.string().describe("Link to the task page in the web app."),
})

const assigneeFields = {
  assigneeUserId: userId(
    "Responsible member. Set exactly one of `assigneeUserId` / `assigneeTeamId`.",
  ).optional(),
  assigneeTeamId: teamId
    .describe(
      "Responsible team. Get it from `inboxTeams.list`. Set exactly one of `assigneeUserId` / `assigneeTeamId`.",
    )
    .optional(),
}

const editableFields = {
  title: z
    .string()
    .trim()
    .min(1)
    .max(TASK_LIMITS.maxTitleLength)
    .describe("Short task title shown in lists and notifications."),
  description: z
    .string()
    .max(TASK_LIMITS.maxDescriptionLength)
    .nullish()
    .describe("Optional details; null clears it on update."),
  priority: taskPriorities
    .optional()
    .describe("Importance. Defaults to `normal` on create."),
  dueAt: z.coerce
    .date()
    .nullish()
    .describe("Due date-time, ISO 8601. Null clears it."),
  remindAt: z.coerce
    .date()
    .nullish()
    .describe("Reminder date-time, ISO 8601, not later than `dueAt`."),
}

export const createTaskPublicRequest = z.object({
  ...editableFields,
  ...assigneeFields,
  watcherUserIds: z
    .array(userId("Watcher."))
    .max(TASK_LIMITS.maxWatchers)
    .optional()
    .describe(
      "Extra watchers. The assignee is added automatically. Get user ids from `workspaceMembers.list`.",
    ),
  contactId: zodBigintAsString()
    .optional()
    .describe("Link a contact. Get it from `contacts.list`."),
  conversationId: zodBigintAsString()
    .optional()
    .describe(
      "Link a conversation (its contact is linked too). Get it from `conversations.list`.",
    ),
  messageId: zodBigintAsString()
    .optional()
    .describe(
      "Link a client message; requires `conversationId`. Get it from `messages.list`.",
    ),
})

export const updateTaskPublicRequest = taskIdPathParam.extend({
  title: editableFields.title.optional(),
  description: editableFields.description,
  status: taskStatuses
    .optional()
    .describe("`todo`, `in_progress`, `done`, or `canceled`."),
  priority: taskPriorities
    .optional()
    .describe("Importance: `low`, `normal`, `high`, or `urgent`."),
  dueAt: editableFields.dueAt,
  remindAt: editableFields.remindAt,
  ...assigneeFields,
})

export const taskFilterFields = {
  status: z
    .enum([...taskStatusValues, "open"])
    .optional()
    .describe("One status, or `open` for `todo` + `in_progress`."),
  priority: taskPriorities
    .optional()
    .describe("Filter by importance: `low`, `normal`, `high`, or `urgent`."),
  due: taskDueFilters
    .optional()
    .describe(
      "`overdue` (open and past due), `today`, `week` (7 days from today, workspace time zone) or `none` (no due date).",
    ),
  assigneeUserId: userId("Only tasks assigned to this member.").optional(),
  assigneeTeamId: teamId.optional(),
  createdByUserId: userId("Only tasks this member created.").optional(),
  watcherUserId: userId("Only tasks this member watches.").optional(),
  teamMemberUserId: userId(
    "Only tasks assigned to a team this member belongs to.",
  ).optional(),
  contactId: zodBigintAsString()
    .optional()
    .describe(
      "Only tasks linked to this contact. Get it from `contacts.list`.",
    ),
  conversationId: zodBigintAsString()
    .optional()
    .describe(
      "Only tasks linked to this conversation. Get it from `conversations.list`.",
    ),
}

export const listTasksPublicRequest = withPublicPaging(
  z.object(taskFilterFields),
)

export const countTasksPublicRequest = z.object(taskFilterFields)

export const countTasksResponse = z.object({ total: z.number().int() })

export const takeTaskPublicRequest = taskIdPathParam.extend({
  userId: userId("Member of the assignee team who takes the task."),
})

export const taskTabs = z.enum([
  "mine",
  "createdByMe",
  "watching",
  "myTeams",
  "all",
])
export type TaskTab = z.infer<typeof taskTabs>

export const listTasksPublicResponse = publicListResponse(taskPublicResource)

export const taskWatcherPublicRequest = taskIdPathParam.extend({
  userId: userId("Member to add or remove."),
})

const taskSystemEventResource = z.object({
  type: taskSystemEventTypes,
  from: z.string().nullable(),
  to: z
    .string()
    .nullable()
    .describe("Status/priority value, ISO date, or `user:<id>` / `team:<id>`."),
  byUserId: z.string().nullable(),
})

const taskCommentMentionsResource = z.object({
  userIds: z.array(z.string()),
  teamIds: z.array(z.string()),
})

const taskCommentAttachmentResource = z.object({
  index: z.number().int(),
  name: z.string(),
  size: z.number().int(),
  mimeType: z.string(),
  url: z
    .string()
    .describe("Signed download URL (about one hour). Use as a link or href."),
})

export const taskCommentPublicResource = z.object({
  id: z.string(),
  kind: internalMessageKinds.describe(
    "`comment` from a person or token, `system` for a change event.",
  ),
  authorUserId: z.string().nullable(),
  authorLabel: z.string().nullable(),
  text: z.string().nullable(),
  mentions: taskCommentMentionsResource.describe(
    "Parsed @mentions from the comment text.",
  ),
  attachments: z.array(taskCommentAttachmentResource),
  systemEvent: taskSystemEventResource.nullable(),
  deleted: z.boolean(),
  editedAt: z.date().nullable(),
  createdAt: z.date(),
})

export const taskPrivateResource = taskPublicResource.extend({
  unreadCount: z
    .number()
    .int()
    .default(0)
    .describe("Unread comments for the signed-in member (private API only)."),
})

export const listTasksPrivateResponse = publicListResponse(taskPrivateResource)

export const listTaskCommentsPublicRequest = withPublicPaging(taskIdPathParam)

export const listTaskCommentsPublicResponse = publicListResponse(
  taskCommentPublicResource,
)

const taskCommentAttachmentInput = z.object({
  key: z
    .string()
    .min(1)
    .describe("Object key returned by `tasks.attachments.upload`."),
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .describe("Original file name from the upload step."),
})

const mentionFormatDescription =
  "Optional comment text. Mention people or teams with `@[Name](user:<userId>)` or `@[Team](team:<teamId>)` — get ids from `workspaceMembers.list` (`userId`) and `inboxTeams.list` (`id`)."

export const taskCommentIdPathParam = taskIdPathParam.extend({
  commentId: zodBigintAsString().describe(
    "Comment id. Get it from `tasks.comments.list`.",
  ),
})

export const createTaskCommentPublicRequest = taskIdPathParam
  .extend({
    text: z
      .string()
      .trim()
      .max(TASK_LIMITS.maxCommentLength)
      .optional()
      .describe(mentionFormatDescription),
    attachments: z
      .array(taskCommentAttachmentInput)
      .max(10)
      .optional()
      .describe(
        "Files uploaded via `tasks.attachments.upload` (at most 10 per comment).",
      ),
  })
  .superRefine((value, ctx) => {
    const hasText = (value.text?.length ?? 0) > 0
    const hasAttachments = (value.attachments?.length ?? 0) > 0
    if (!(hasText || hasAttachments)) {
      ctx.addIssue({
        code: "custom",
        message: "Provide comment text and/or attachments.",
        path: ["text"],
      })
    }
  })

export const updateTaskCommentPublicRequest = taskCommentIdPathParam
  .extend({
    text: z
      .string()
      .trim()
      .min(1)
      .max(TASK_LIMITS.maxCommentLength)
      .optional()
      .describe(mentionFormatDescription),
  })
  .superRefine((value, ctx) => {
    if (value.text === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Comment text is required.",
        path: ["text"],
      })
    }
  })

const TASK_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

export const uploadTaskAttachmentRequest = taskIdPathParam.extend({
  file: z
    .file()
    .refine((file) => file.size <= TASK_ATTACHMENT_MAX_BYTES, {
      message: "Max file size is 25MB.",
    })
    .describe(
      "Multipart file body (one file, up to 25MB). Pass the returned `key`/`name` into `tasks.comments.create`.",
    ),
})

export const uploadTaskAttachmentResponse = z.object({
  key: z.string(),
  name: z.string(),
  size: z.number().int(),
  mimeType: z.string(),
})
