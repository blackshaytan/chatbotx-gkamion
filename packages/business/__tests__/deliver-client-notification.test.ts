import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findExternalCustomerIdentity: vi.fn(),
  findExternalClientNotification: vi.fn(),
  insertExternalClientNotification: vi.fn(),
  listByContactId: vi.fn(),
  findOrCreate: vi.fn(),
  resolveWorkspaceFreezeReasonById: vi.fn(),
  planCascadeCandidates: vi.fn(),
  listSmtpInboxIds: vi.fn(),
  getJob: vi.fn(),
  add: vi.fn(),
  runExclusive: vi.fn(),
  createId: vi.fn(() => "generated-id-1"),
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: {},
  and: vi.fn(() => "and"),
  eq: vi.fn(() => "eq"),
  or: vi.fn(() => "or"),
  sql: vi.fn(() => "sql"),
  ne: vi.fn(() => "ne"),
  inArray: vi.fn(() => "inArray"),
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  findExternalCustomerIdentity: mocks.findExternalCustomerIdentity,
  findExternalClientNotification: mocks.findExternalClientNotification,
  insertExternalClientNotification: mocks.insertExternalClientNotification,
}))

vi.mock("@chatbotx.io/redis", () => ({
  distributedLock: { runExclusive: mocks.runExclusive },
}))

vi.mock("@chatbotx.io/worker-config", () => ({
  IntegrationJobAction: {
    deliverClientNotification: "deliverClientNotification",
  },
  integrationQueue: {
    getJob: mocks.getJob,
    add: mocks.add,
  },
}))

vi.mock("@chatbotx.io/utils", () => ({
  createId: mocks.createId,
}))

vi.mock("../src/contact-inbox/service", () => ({
  contactInboxService: { listByContactId: mocks.listByContactId },
}))

vi.mock("../src/conversation/service", () => ({
  conversationService: { findOrCreate: mocks.findOrCreate },
}))

vi.mock("../src/workspace-lifecycle/with-blocked-owner-guard", () => ({
  resolveWorkspaceFreezeReasonById: mocks.resolveWorkspaceFreezeReasonById,
}))

vi.mock("../src/errors", () => ({
  notFoundException: (message: string) =>
    Object.assign(new Error(message), {
      code: "notFound",
      httpStatusCode: 404,
    }),
  validationException: (field: string, message: string) =>
    Object.assign(new Error(message), {
      code: "invalidRequestData",
      httpStatusCode: 422,
      field,
    }),
}))

vi.mock("../src/external-crm/order-notification", () => ({
  planCascadeCandidates: mocks.planCascadeCandidates,
}))

vi.mock("../src/external-crm/start-order-notifications", () => ({
  listSmtpInboxIds: mocks.listSmtpInboxIds,
}))

const { queueClientNotification } = await import(
  "../src/external-crm/deliver-client-notification"
)

const input = {
  workspaceId: "ws-1",
  externalCustomerId: "gk-1",
  eventId: "evt-1",
  text: "hello",
  messengerText: "messenger hello",
  email: "a@example.com",
  emailSubject: "subject",
  externalOrderId: "25421",
  statusId: 21,
}

const identity = { contactId: "123" }
const conversation = { id: "conv-1" }
const candidate = { channel: "max", contactInboxId: "ci-1" }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findExternalCustomerIdentity.mockResolvedValue(identity)
  mocks.resolveWorkspaceFreezeReasonById.mockResolvedValue({
    freezeReason: null,
  })
  mocks.listByContactId.mockResolvedValue([])
  mocks.listSmtpInboxIds.mockResolvedValue(["smtp-1"])
  mocks.planCascadeCandidates.mockReturnValue([candidate])
  mocks.findOrCreate.mockResolvedValue(conversation)
  mocks.findExternalClientNotification.mockResolvedValue(null)
  mocks.insertExternalClientNotification.mockResolvedValue(undefined)
  mocks.getJob.mockResolvedValue(null)
  mocks.add.mockResolvedValue(undefined)
  mocks.runExclusive.mockImplementation(
    ({ fn }: { fn: () => Promise<unknown> }) => fn(),
  )
})

describe("queueClientNotification", () => {
  test("first call queues one job and inserts one row", async () => {
    const result = await queueClientNotification(input)

    expect(result).toEqual({
      contactId: "123",
      conversationId: "conv-1",
      queued: true,
      duplicate: false,
    })
    expect(mocks.add).toHaveBeenCalledTimes(1)
    expect(mocks.insertExternalClientNotification).toHaveBeenCalledTimes(1)
    expect(mocks.insertExternalClientNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "generated-id-1",
        workspaceId: "ws-1",
        provider: "gkamion",
        eventId: "evt-1",
        contactId: "123",
        externalOrderId: "25421",
        statusId: 21,
      }),
    )
  })

  test("DB row exists returns duplicate without adding a job", async () => {
    mocks.findExternalClientNotification.mockResolvedValue({
      id: "row-1",
      contactId: "123",
    })

    const result = await queueClientNotification(input)

    expect(result).toEqual({
      contactId: "123",
      conversationId: "conv-1",
      queued: false,
      duplicate: true,
    })
    expect(mocks.getJob).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.insertExternalClientNotification).not.toHaveBeenCalled()
  })

  test("DB row exists with no job still returns duplicate (evicted BullMQ dedup)", async () => {
    mocks.findExternalClientNotification.mockResolvedValue({
      id: "row-1",
      contactId: "123",
    })
    mocks.getJob.mockResolvedValue(null)

    const result = await queueClientNotification(input)

    expect(result).toEqual({
      contactId: "123",
      conversationId: "conv-1",
      queued: false,
      duplicate: true,
    })
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.insertExternalClientNotification).not.toHaveBeenCalled()
  })

  test("job exists without DB row backfills the row and returns duplicate", async () => {
    mocks.getJob.mockResolvedValue({ id: "job-1" })

    const result = await queueClientNotification(input)

    expect(result).toEqual({
      contactId: "123",
      conversationId: "conv-1",
      queued: false,
      duplicate: true,
    })
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.insertExternalClientNotification).toHaveBeenCalledTimes(1)
  })

  test("add throws job already exists inserts row and returns duplicate", async () => {
    mocks.add.mockRejectedValue(new Error("Job already exists"))

    const result = await queueClientNotification(input)

    expect(result).toEqual({
      contactId: "123",
      conversationId: "conv-1",
      queued: false,
      duplicate: true,
    })
    expect(mocks.insertExternalClientNotification).toHaveBeenCalledTimes(1)
  })

  test("add throws another error propagates without inserting", async () => {
    mocks.add.mockRejectedValue(new Error("Redis connection failed"))

    await expect(queueClientNotification(input)).rejects.toThrow(
      "Redis connection failed",
    )
    expect(mocks.insertExternalClientNotification).not.toHaveBeenCalled()
  })
})
