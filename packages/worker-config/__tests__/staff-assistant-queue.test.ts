import { expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  add: vi.fn(
    async (_name: string, _data: unknown, _options: { jobId?: string }) =>
      undefined,
  ),
}))
vi.mock("bullmq", () => ({
  Queue: class {
    add = mocks.add
  },
}))
vi.mock("../src/lib/connection", () => ({
  defaultJobOptions: {},
  fakeQueue: { add: mocks.add },
  getQueueConnection: () => ({}),
  isNoRedisEnv: () => false,
}))
const {
  AIJobAction,
  aiJobDataSchema,
  enqueueStaffAssistantReply,
  enqueueStaffAssistantWatch,
} = await import("../src/queues/ai-agent")

test("staff reply uses a replaceable per-chat debounce", async () => {
  const data = { workspaceId: "1", threadId: "2", messageId: "3" }
  expect(
    aiJobDataSchema.safeParse({ type: AIJobAction.staffAssistantReply, data })
      .success,
  ).toBe(true)
  await enqueueStaffAssistantReply(data)
  expect(mocks.add).toHaveBeenLastCalledWith(
    AIJobAction.staffAssistantReply,
    { type: AIJobAction.staffAssistantReply, data },
    expect.objectContaining({
      delay: 1500,
      deduplication: expect.objectContaining({
        id: "staffAssistantReply-2",
        replace: true,
        keepLastIfActive: true,
      }),
    }),
  )
})

test("watch identifiers remain valid when Hermes run IDs contain colons", async () => {
  const data = { workspaceId: "1", threadId: "2", runId: "run:123" }
  expect(
    aiJobDataSchema.safeParse({ type: AIJobAction.staffAssistantWatch, data })
      .success,
  ).toBe(true)
  await enqueueStaffAssistantWatch(data)
  expect(mocks.add.mock.lastCall?.[2]?.jobId).not.toContain(":")
})
