import { describe, expect, test } from "vitest"
import { chatService } from "../../src/chat/service"

describe("chatService", () => {
  test("exports the stage-one chat operations", () => {
    expect(chatService).toMatchObject({
      open: expect.any(Function),
      list: expect.any(Function),
      get: expect.any(Function),
      listMessages: expect.any(Function),
      send: expect.any(Function),
      edit: expect.any(Function),
      deleteMessage: expect.any(Function),
      markRead: expect.any(Function),
      uploadAttachment: expect.any(Function),
      findAttachment: expect.any(Function),
    })
  })
})
