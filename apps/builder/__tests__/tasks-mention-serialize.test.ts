import { describe, expect, test } from "vitest"
import {
  serializeTaskMentionDocument,
  taskMentionTextToHtml,
} from "@/features/tasks/components/mention-editor"
import { toTaskMentionAttributes } from "@/features/tasks/components/task-mention-list"

describe("task mention serialization", () => {
  test("serializes mention nodes to internal tokens and preserves paragraphs", () => {
    expect(
      serializeTaskMentionDocument({
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              {
                type: "mention",
                attrs: { id: "user:12", label: "Ada" },
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: { id: "team:7", label: "Support" },
              },
            ],
          },
        ],
      }),
    ).toBe("Hello @[Ada](user:12)\n@[Support](team:7)")
  })

  test("parses tokens into TipTap mention markup without turning plain text into HTML", () => {
    expect(taskMentionTextToHtml("<@[Ada](user:12)>")).toBe(
      '<p>&lt;<span data-type="mention" data-id="user:12" data-label="Ada"></span>&gt;</p>',
    )
  })

  test("serializes the mention picker command attributes as an internal token", () => {
    const attributes = toTaskMentionAttributes({
      id: "12",
      kind: "user",
      label: `A]${"d".repeat(100)}`,
    })

    expect(
      serializeTaskMentionDocument({
        content: [{ type: "mention", attrs: attributes }],
      }),
    ).toBe(`@[A${"d".repeat(99)}](user:12)`)
  })
})
