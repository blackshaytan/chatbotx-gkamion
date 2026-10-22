import { beforeEach, describe, expect, test, vi } from "vitest"

const mockGet = vi.hoisted(() => vi.fn())

vi.mock("../src/exception", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/exception")>()
  return { ...actual, rescue: (_: string, fn: () => Promise<unknown>) => fn() }
})

vi.mock("../src/lib/http-client", () => ({
  createTelegramClient: () => ({ get: mockGet }),
}))

vi.mock("../src/apis/bot", () => ({
  getTelegramFileUrl: vi.fn(async (_auth: unknown, fileId: string) =>
    fileId === "file-1"
      ? "https://api.telegram.org/file/botTOKEN/photos/file_1.jpg"
      : undefined,
  ),
}))

const { contactHandlers } = await import("../src/handlers/contact")
const { getTelegramFileUrl } = await import("../src/apis/bot")

const createProps = (sourceId = "100") =>
  ({
    ctx: {
      auth: { secretText: "TOKEN" },
    },
    data: { sourceId },
  }) as never

describe("Telegram getContactProfilePicUrl", () => {
  beforeEach(() => {
    mockGet.mockReset()
    vi.mocked(getTelegramFileUrl).mockClear()
  })

  test("returns a fresh Telegram file URL for the contact photo", async () => {
    mockGet.mockResolvedValue({
      result: { photos: [[{ file_id: "file-1" }]] },
    })

    await expect(
      contactHandlers.getContactProfilePicUrl?.(createProps()),
    ).resolves.toBe("https://api.telegram.org/file/botTOKEN/photos/file_1.jpg")

    expect(mockGet).toHaveBeenCalledWith("getUserProfilePhotos", {
      searchParams: { user_id: "100", limit: "1" },
    })
    expect(getTelegramFileUrl).toHaveBeenCalledWith(
      { secretText: "TOKEN" },
      "file-1",
    )
  })

  test("returns null when the user has no profile photos", async () => {
    mockGet.mockResolvedValue({ result: { photos: [] } })

    await expect(
      contactHandlers.getContactProfilePicUrl?.(createProps()),
    ).resolves.toBeNull()
  })
})
