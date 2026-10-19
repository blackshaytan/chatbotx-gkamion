import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listDuePolls: vi.fn(),
  runPoll: vi.fn(),
  lowAdd: vi.fn(async () => undefined),
  integrationAdd: vi.fn(async () => undefined),
}))

vi.mock("@chatbotx.io/connections", () => ({
  listDuePolls: mocks.listDuePolls,
  runPoll: mocks.runPoll,
}))

vi.mock("@chatbotx.io/worker-config", () => ({
  buildChannelPollJobId: (id: string) => `channel-poll-${id}`,
  IntegrationJobAction: { incomingMessage: "incomingMessage" },
  integrationQueue: { add: mocks.integrationAdd },
  LowJobAction: { pollChannel: "pollChannel" },
  lowQueue: { add: mocks.lowAdd },
}))

vi.mock("../src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { dispatchChannelPolls } = await import(
  "../src/schedule/handlers/dispatch-channel-polls"
)
const { pollChannel } = await import("../src/low/handlers/poll-channel")

beforeEach(() => {
  vi.clearAllMocks()
})

describe("dispatchChannelPolls", () => {
  test("enqueues one deduplicated low job per due connection", async () => {
    mocks.listDuePolls.mockResolvedValue([
      { connectionId: "c1", workspaceId: "w1" },
      { connectionId: "c2", workspaceId: "w2" },
    ])

    await dispatchChannelPolls()

    expect(mocks.lowAdd).toHaveBeenCalledTimes(2)
    expect(mocks.lowAdd).toHaveBeenCalledWith(
      "pollChannel",
      { type: "pollChannel", data: { connectionId: "c1", workspaceId: "w1" } },
      {
        jobId: "channel-poll-c1",
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      },
    )
  })
})

describe("pollChannel", () => {
  test("forwards polled events to the incomingMessage integration job", async () => {
    mocks.runPoll.mockImplementation(async ({ enqueue }) => {
      await enqueue({
        integrationType: "zzap",
        integrationIdentifier: "42",
        payload: { a: 1 },
      })
      return { status: "ok", events: 1 }
    })

    await pollChannel({ connectionId: "c1", workspaceId: "w1" })

    expect(mocks.runPoll).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "c1", workspaceId: "w1" }),
    )
    expect(mocks.integrationAdd).toHaveBeenCalledWith("incomingMessage", {
      type: "incomingMessage",
      data: {
        integrationType: "zzap",
        integrationIdentifier: "42",
        payload: { a: 1 },
      },
    })
  })
})
