import {
  createId,
  zodBigintAsString,
  zodBigintIdAsString,
} from "@chatbotx.io/utils"
import { z } from "zod"
import { zodFieldReference } from "../field-reference"
import {
  errorStateDefaultFn,
  errorStateSchema,
  successStateDefaultFn,
  successStateSchema,
} from "../states"
import { stepTypes } from "./step-action"

// Literals, not imported from @chatbotx.io/database: flow-config must not depend on database.
// Templates may expand longer — the handler truncates to TASK_LIMITS (255 / 10_000).
export const CREATE_TASK_LIMITS = {
  maxTitleTemplateLength: 1000,
  maxDescriptionTemplateLength: 10_000,
  maxOffset: 999_999,
} as const

export const createTaskPriorities = z.enum(["low", "normal", "high", "urgent"])
export const createTaskDueUnits = z.enum(["minutes", "hours", "days"])
export type CreateTaskDueUnit = z.infer<typeof createTaskDueUnits>
export const createTaskUnitMinutes = {
  minutes: 1,
  hours: 60,
  days: 1440,
} as const satisfies Record<CreateTaskDueUnit, number>

export const createTaskAssigneeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: zodBigintIdAsString() }),
  z.object({ type: z.literal("team"), teamId: zodBigintIdAsString() }),
  z.object({ type: z.literal("conversation") }),
])
export type CreateTaskAssignee = z.infer<typeof createTaskAssigneeSchema>

export const createTaskStepSchema = z
  .object({
    id: zodBigintAsString().describe(
      "Step id (numeric string), unique within the flow.",
    ),
    stepType: z
      .literal(stepTypes.enum.createTask)
      .describe('Step type discriminator: "createTask".'),
    title: z
      .string()
      .trim()
      .min(1)
      .max(CREATE_TASK_LIMITS.maxTitleTemplateLength)
      .describe(
        "Task title; supports variables such as the contact name. Cut to 255 characters after substitution.",
      ),
    description: z
      .string()
      .max(CREATE_TASK_LIMITS.maxDescriptionTemplateLength)
      .describe(
        "Task description; supports variables. Empty string means no description.",
      ),
    assignee: createTaskAssigneeSchema.describe(
      "Who gets the task: a member (`userId` from `workspaceMembers.list`), a team (`teamId` from `inboxTeams.list`) or `conversation` — whoever is assigned to the current conversation (no assignee → the error output).",
    ),
    dueIn: z
      .object({
        amount: z.coerce
          .number()
          .int()
          .min(1)
          .max(CREATE_TASK_LIMITS.maxOffset),
        unit: createTaskDueUnits,
      })
      .nullable()
      .describe(
        "Due date relative to the moment the step runs; null for no due date.",
      ),
    remindBeforeMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(CREATE_TASK_LIMITS.maxOffset)
      .nullable()
      .describe(
        "Reminder N minutes before the due date; null for none. Requires `dueIn`.",
      ),
    priority: createTaskPriorities,
    outputFieldId: zodFieldReference()
      .or(z.literal(""))
      .describe(
        "Optional field that receives the new task id: a custom field id from `customFields.list`, or `bot_field:<id>` from `botFields.list`; empty string to skip.",
      ),
    states: z.tuple([successStateSchema, errorStateSchema]),
  })
  .superRefine((data, ctx) => {
    if (data.remindBeforeMinutes === null) {
      return
    }
    if (data.dueIn === null) {
      ctx.addIssue({
        code: "custom",
        path: ["remindBeforeMinutes"],
        message: "Reminder requires a due date",
      })
      return
    }
    if (
      data.remindBeforeMinutes >
      data.dueIn.amount * createTaskUnitMinutes[data.dueIn.unit]
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["remindBeforeMinutes"],
        message: "Reminder must not be later than the due date",
      })
    }
  })
export type CreateTaskStepSchema = z.infer<typeof createTaskStepSchema>
export type CreateTaskStepInput = z.input<typeof createTaskStepSchema>

export const createTaskStepDefaultFn = (): CreateTaskStepSchema => ({
  id: createId(),
  stepType: stepTypes.enum.createTask,
  title: "",
  description: "",
  assignee: { type: "conversation" },
  dueIn: null,
  remindBeforeMinutes: null,
  priority: "normal",
  outputFieldId: "",
  states: [successStateDefaultFn(), errorStateDefaultFn()],
})
