import { describe, expect, test } from "vitest"
import {
  commentRow,
  systemMessageRow,
} from "../../src/internal-thread/message-rows"
import { toInternalMessageView } from "../../src/internal-thread/view"

describe("internal message rows", () => {
  test("a comment by an API token carries its label and empty mentions", () => {
    expect(
      commentRow({
        workspaceId: "ws-1",
        threadId: "th-1",
        text: "Готово",
        actor: { kind: "api", label: "Hermes" },
      }),
    ).toEqual({
      workspaceId: "ws-1",
      threadId: "th-1",
      kind: "comment",
      authorUserId: null,
      authorLabel: "Hermes",
      text: "Готово",
      mentions: { userIds: [], teamIds: [] },
      attachments: [],
      systemEvent: null,
    })
  })

  test("a system row stores the event and no text", () => {
    const event = {
      type: "created",
      from: null,
      to: null,
      byUserId: "u-1",
    } as const
    expect(
      systemMessageRow({
        workspaceId: "ws-1",
        threadId: "th-1",
        event,
        authorLabel: null,
      }),
    ).toMatchObject({
      kind: "system",
      text: null,
      systemEvent: event,
      authorUserId: "u-1",
    })
  })

  test("a deleted message hides its text", () => {
    const view = toInternalMessageView({
      id: "m-1",
      threadId: "th-1",
      workspaceId: "ws-1",
      kind: "comment",
      authorUserId: "u-1",
      authorLabel: null,
      text: "secret",
      mentions: { userIds: [], teamIds: [] },
      attachments: [],
      systemEvent: null,
      editedAt: null,
      deletedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect(view.text).toBeNull()
    expect(view.deleted).toBe(true)
  })
})
