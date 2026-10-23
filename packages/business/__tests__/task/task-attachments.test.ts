import { beforeEach, describe, expect, test, vi } from "vitest"

const uploader = vi.hoisted(() => ({
  putObject: vi.fn(),
  headObject: vi.fn(),
}))

vi.mock("@chatbotx.io/filesystem", () => ({ uploader }))
vi.mock("@chatbotx.io/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@chatbotx.io/utils")>()
  return { ...actual, createId: vi.fn(() => "file-id-1") }
})

const { resolveTaskAttachments, TASK_ATTACHMENT_LIMITS, uploadTaskAttachment } =
  await import("../../src/internal-thread/attachments")

const file = (size: number, name = "doc.pdf", type = "application/pdf") =>
  new File([new Uint8Array(size)], name, { type })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("uploadTaskAttachment", () => {
  test("stores under the task prefix without public ACL", async () => {
    uploader.putObject.mockResolvedValue(undefined)
    const result = await uploadTaskAttachment({
      workspaceId: "ws-1",
      taskId: "t-1",
      file: file(100),
    })
    expect(uploader.putObject).toHaveBeenCalledWith(
      "private/space/ws-1/tasks/t-1/file-id-1",
      expect.any(Buffer),
      expect.objectContaining({
        ContentType: "application/pdf",
        ContentDisposition: expect.stringContaining("doc.pdf"),
      }),
    )
    expect(uploader.putObject.mock.calls[0]?.[2]).not.toHaveProperty("ACL")
    expect(result).toMatchObject({
      key: "private/space/ws-1/tasks/t-1/file-id-1",
      name: "doc.pdf",
      size: 100,
      mimeType: "application/pdf",
    })
  })

  test("strips quotes, slashes and control characters from the name", async () => {
    uploader.putObject.mockResolvedValue(undefined)
    const unsafe = new File(["x"], 'a"b/c\\d\u0007.pdf', {
      type: "application/pdf",
    })
    const result = await uploadTaskAttachment({
      workspaceId: "ws-1",
      taskId: "t-1",
      file: unsafe,
    })
    expect(result.name).toBe("abcd.pdf")
  })

  test("rejects files over maxBytes", async () => {
    await expect(
      uploadTaskAttachment({
        workspaceId: "ws-1",
        taskId: "t-1",
        file: file(TASK_ATTACHMENT_LIMITS.maxBytes + 1),
      }),
    ).rejects.toMatchObject({ code: "validation" })
    expect(uploader.putObject).not.toHaveBeenCalled()
  })
})

describe("resolveTaskAttachments", () => {
  test("validates prefix and reads size from headObject", async () => {
    uploader.headObject.mockResolvedValue({
      ContentLength: 50,
      ContentType: "image/png",
    })
    const resolved = await resolveTaskAttachments({
      workspaceId: "ws-1",
      taskId: "t-1",
      items: [
        {
          key: "private/space/ws-1/tasks/t-1/file-id-1",
          name: "pic.png",
        },
      ],
    })
    expect(resolved).toEqual([
      {
        key: "private/space/ws-1/tasks/t-1/file-id-1",
        name: "pic.png",
        size: 50,
        mimeType: "image/png",
      },
    ])
  })

  test("rejects foreign prefix", async () => {
    await expect(
      resolveTaskAttachments({
        workspaceId: "ws-1",
        taskId: "t-1",
        items: [{ key: "private/space/ws-2/tasks/t-1/x", name: "x" }],
      }),
    ).rejects.toMatchObject({ code: "validation" })
  })

  test("rejects missing object", async () => {
    uploader.headObject.mockRejectedValue(new Error("NotFound"))
    await expect(
      resolveTaskAttachments({
        workspaceId: "ws-1",
        taskId: "t-1",
        items: [{ key: "private/space/ws-1/tasks/t-1/missing", name: "x" }],
      }),
    ).rejects.toMatchObject({ code: "validation" })
  })

  test("rejects too many files", async () => {
    const items = Array.from(
      { length: TASK_ATTACHMENT_LIMITS.maxFiles + 1 },
      (_, i) => ({
        key: `private/space/ws-1/tasks/t-1/f-${i}`,
        name: `f-${i}`,
      }),
    )
    await expect(
      resolveTaskAttachments({
        workspaceId: "ws-1",
        taskId: "t-1",
        items,
      }),
    ).rejects.toMatchObject({ code: "validation" })
  })

  test("sanitizes attachment names", async () => {
    uploader.headObject.mockResolvedValue({
      ContentLength: 1,
      ContentType: "text/plain",
    })
    const [resolved] = await resolveTaskAttachments({
      workspaceId: "ws-1",
      taskId: "t-1",
      items: [
        {
          key: "private/space/ws-1/tasks/t-1/file-id-1",
          name: "bad/name\\with\\slashes",
        },
      ],
    })
    expect(resolved?.name).toBe("badnamewithslashes")
  })
})
