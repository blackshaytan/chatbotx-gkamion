import { createTaskStepDefaultFn } from "@chatbotx.io/flow-config"
import { RealtimeEventType } from "@chatbotx.io/partysocket-config"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  taskCreate: vi.fn(),
  findActiveById: vi.fn(),
  findByUncached: vi.fn(),
  listUserIdsByTeamId: vi.fn(),
  publishToWorkspaceParty: vi.fn(),
  referencedFieldExists: vi.fn(),
  writeReferencedFieldValue: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock("@chatbotx.io/business", () => ({
  taskService: { create: mocks.taskCreate },
  flowService: { findActiveById: mocks.findActiveById },
  conversationService: { findByUncached: mocks.findByUncached },
  inboxTeamService: { listUserIdsByTeamId: mocks.listUserIdsByTeamId },
  publishToWorkspaceParty: mocks.publishToWorkspaceParty,
}))

vi.mock("@chatbotx.io/variables", () => ({
  resolveContactVariablesDeep: vi.fn(
    (_contactId: string, value: { title: string; description: string }) => {
      const replaceName = (text: string) =>
        text.replace(/\{\{contact\.name\}\}/g, "Ivan")
      return Promise.resolve({
        title: replaceName(value.title),
        description: replaceName(value.description),
      })
    },
  ),
}))

vi.mock("../src/integration/handlers/tool-handler", () => ({
  referencedFieldExists: mocks.referencedFieldExists,
  writeReferencedFieldValue: mocks.writeReferencedFieldValue,
}))

vi.mock("../src/lib/logger", () => ({
  logger: {
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
    info: vi.fn(),
  },
}))

const { handleCreateTask, resolveCreateTaskSchedule } = await import(
  "../src/integration/handlers/create-task-handler"
)

const baseConversation = {
  id: "conversation-1",
  workspaceId: "workspace-1",
  contactId: "contact-1",
}

const baseContactInbox = {
  id: "contact-inbox-1",
  contactId: "contact-1",
  inboxId: "inbox-1",
}

const baseFlowVersion = {
  flowId: "flow-1",
} as { flowId: string }

const createProps = (
  stepOverrides: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) =>
  ({
    conversation: baseConversation,
    contactInbox: baseContactInbox,
    flowVersion: baseFlowVersion,
    step: {
      ...createTaskStepDefaultFn(),
      id: "step-1",
      title: "Task for user",
      assignee: { type: "user", userId: "user-1" },
      ...stepOverrides,
    },
    ...extra,
  }) as Parameters<typeof handleCreateTask>[0]

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"))
  mocks.findActiveById.mockResolvedValue({ name: "Welcome flow" })
  mocks.taskCreate.mockResolvedValue({ id: "task-99" })
  mocks.referencedFieldExists.mockResolvedValue(false)
  mocks.writeReferencedFieldValue.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("resolveCreateTaskSchedule", () => {
  const now = new Date("2026-10-26T12:00:00.000Z")

  test("minutes unit", () => {
    const result = resolveCreateTaskSchedule({
      now,
      dueIn: { amount: 15, unit: "minutes" },
      remindBeforeMinutes: null,
    })
    expect(result.dueAt?.toISOString()).toBe("2026-10-26T12:15:00.000Z")
    expect(result.remindAt).toBeNull()
  })

  test("days unit with reminder", () => {
    const result = resolveCreateTaskSchedule({
      now,
      dueIn: { amount: 1, unit: "days" },
      remindBeforeMinutes: 60,
    })
    expect(result.dueAt?.toISOString()).toBe("2026-10-27T12:00:00.000Z")
    expect(result.remindAt?.toISOString()).toBe("2026-10-27T11:00:00.000Z")
  })

  test("null due clears schedule", () => {
    expect(
      resolveCreateTaskSchedule({
        now,
        dueIn: null,
        remindBeforeMinutes: null,
      }),
    ).toEqual({ dueAt: null, remindAt: null })
  })
})

describe("handleCreateTask", () => {
  test("success with user assignee creates task and publishes realtime", async () => {
    const result = await handleCreateTask(createProps())

    expect(result).toEqual({ status: "success", result: { taskId: "task-99" } })
    expect(mocks.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        assignee: { type: "user", userId: "user-1" },
        targets: {
          contactId: "contact-1",
          conversationId: "conversation-1",
        },
      }),
    )
    expect(mocks.taskCreate.mock.calls[0][0]).not.toHaveProperty("messageId")
    expect(mocks.publishToWorkspaceParty).toHaveBeenCalledWith("workspace-1", {
      eventType: RealtimeEventType.taskChanged,
      data: { taskId: "task-99" },
    })
  })

  test("uses flow name for actor label", async () => {
    await handleCreateTask(createProps())

    expect(mocks.findActiveById).toHaveBeenCalledWith({
      id: "flow-1",
      workspaceId: "workspace-1",
    })
    expect(mocks.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { kind: "flow", label: "Welcome flow" },
      }),
    )
  })

  test("falls back to Flow label when active flow is missing", async () => {
    mocks.findActiveById.mockResolvedValue(null)

    await handleCreateTask(createProps())

    expect(mocks.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { kind: "flow", label: "Flow" },
      }),
    )
  })

  test("substitutes variables and truncates long titles", async () => {
    const longTitle = `${"x".repeat(300)}{contact.name}`
    await handleCreateTask(
      createProps({
        title: longTitle,
        description: "Call {{contact.name}}",
      }),
    )

    expect(mocks.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: `${"x".repeat(255)}`,
        description: "Call Ivan",
      }),
    )
  })

  test("empty title after substitution returns error without create", async () => {
    const result = await handleCreateTask(createProps({ title: "   " }))

    expect(result).toMatchObject({ status: "error" })
    expect(mocks.taskCreate).not.toHaveBeenCalled()
  })

  test("conversation assignee resolves assigned user", async () => {
    mocks.findByUncached.mockResolvedValue({ assignedUserId: "agent-2" })

    await handleCreateTask(createProps({ assignee: { type: "conversation" } }))

    expect(mocks.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        assignee: { type: "user", userId: "agent-2" },
      }),
    )
  })

  test("conversation assignee resolves assigned team with members", async () => {
    mocks.findByUncached.mockResolvedValue({ assignedInboxTeamId: "team-3" })
    mocks.listUserIdsByTeamId.mockResolvedValue(["member-1"])

    await handleCreateTask(createProps({ assignee: { type: "conversation" } }))

    expect(mocks.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        assignee: { type: "team", teamId: "team-3" },
      }),
    )
  })

  test("conversation without assignee returns error", async () => {
    mocks.findByUncached.mockResolvedValue({})

    const result = await handleCreateTask(
      createProps({ assignee: { type: "conversation" } }),
    )

    expect(result).toEqual({
      status: "error",
      errorMessage: "Conversation has no assignee",
      result: null,
    })
    expect(mocks.taskCreate).not.toHaveBeenCalled()
  })

  test("empty team assignee returns error", async () => {
    mocks.listUserIdsByTeamId.mockResolvedValue([])

    const result = await handleCreateTask(
      createProps({ assignee: { type: "team", teamId: "team-1" } }),
    )

    expect(result).toMatchObject({
      status: "error",
      errorMessage: "Team has no members",
    })
    expect(mocks.taskCreate).not.toHaveBeenCalled()
  })

  test("empty team from conversation assignee returns error", async () => {
    mocks.findByUncached.mockResolvedValue({ assignedInboxTeamId: "team-9" })
    mocks.listUserIdsByTeamId.mockResolvedValue([])

    const result = await handleCreateTask(
      createProps({ assignee: { type: "conversation" } }),
    )

    expect(result).toMatchObject({
      status: "error",
      errorMessage: "Team has no members",
    })
    expect(mocks.taskCreate).not.toHaveBeenCalled()
  })

  test("service failure logs err and returns error message", async () => {
    const serviceError = new Error("Assignee is not a member of this workspace")
    mocks.taskCreate.mockRejectedValue(serviceError)

    const result = await handleCreateTask(createProps())

    expect(result).toEqual({
      status: "error",
      errorMessage: "Assignee is not a member of this workspace",
      result: null,
    })
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: serviceError }),
      "[handleCreateTask] failed",
    )
    expect(mocks.loggerError.mock.calls[0][0]).not.toHaveProperty("error")
  })

  test("writes output field when it exists", async () => {
    mocks.referencedFieldExists.mockResolvedValue(true)

    await handleCreateTask(createProps({ outputFieldId: "field-1" }))

    expect(mocks.writeReferencedFieldValue).toHaveBeenCalledWith({
      fieldId: "field-1",
      workspaceId: "workspace-1",
      contactId: "contact-1",
      value: "task-99",
    })
  })

  test("skips output field write when outputFieldId is empty", async () => {
    await handleCreateTask(createProps({ outputFieldId: "" }))

    expect(mocks.referencedFieldExists).not.toHaveBeenCalled()
    expect(mocks.writeReferencedFieldValue).not.toHaveBeenCalled()
  })

  test("skips write when field does not exist but stays success", async () => {
    mocks.referencedFieldExists.mockResolvedValue(false)

    const result = await handleCreateTask(
      createProps({ outputFieldId: "field-missing" }),
    )

    expect(result.status).toBe("success")
    expect(mocks.writeReferencedFieldValue).not.toHaveBeenCalled()
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        contactId: "contact-1",
        fieldId: "field-missing",
      }),
      "[handleCreateTask] output field does not exist; continuing",
    )
  })

  test("write failure warns and stays success", async () => {
    mocks.referencedFieldExists.mockResolvedValue(true)
    const writeError = new Error("write failed")
    mocks.writeReferencedFieldValue.mockRejectedValue(writeError)

    const result = await handleCreateTask(
      createProps({ outputFieldId: "field-1" }),
    )

    expect(result.status).toBe("success")
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ err: writeError }),
      "[handleCreateTask] failed to save task id; continuing",
    )
  })

  test("passes due dates from schedule", async () => {
    await handleCreateTask(
      createProps({
        dueIn: { amount: 2, unit: "hours" },
        remindBeforeMinutes: 30,
      }),
    )

    expect(mocks.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        dueAt: new Date("2026-10-26T14:00:00.000Z"),
        remindAt: new Date("2026-10-26T13:30:00.000Z"),
      }),
    )
  })

  test("null due passes null dates", async () => {
    await handleCreateTask(
      createProps({ dueIn: null, remindBeforeMinutes: null }),
    )

    expect(mocks.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        dueAt: null,
        remindAt: null,
      }),
    )
  })

  test("passes priority and null description", async () => {
    await handleCreateTask(
      createProps({
        priority: "high",
        description: "",
      }),
    )

    expect(mocks.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: "high",
        description: null,
      }),
    )
  })
})
