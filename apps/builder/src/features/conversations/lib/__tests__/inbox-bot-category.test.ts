import { describe, expect, test } from "vitest"
import {
  inboxBotCategoryOptionValues,
  inboxHumanBotCategory,
  resolveInboxListBotCategory,
} from "../inbox-bot-category"

describe("inbox bot category", () => {
  test("offers All, Human and Bot to a workspace admin", () => {
    expect(inboxBotCategoryOptionValues(true)).toEqual(["all", "human", "bot"])
  })

  test("offers only Human to a regular member", () => {
    expect(inboxBotCategoryOptionValues(false)).toEqual(["human"])
    expect(inboxHumanBotCategory).toBe("human")
  })

  test("keeps an admin request unchanged, including an omitted category", () => {
    const input = { workspaceId: "workspace-1", botCategory: "bot" as const }
    expect(resolveInboxListBotCategory(input, true)).toBe(input)
    expect(
      resolveInboxListBotCategory({ workspaceId: "workspace-1" }, true),
    ).toEqual({ workspaceId: "workspace-1" })
  })

  test("pins a regular member to Human whatever they request", () => {
    expect(
      resolveInboxListBotCategory(
        { workspaceId: "workspace-1", botCategory: "all" as const },
        false,
      ),
    ).toEqual({ workspaceId: "workspace-1", botCategory: "human" })
    expect(
      resolveInboxListBotCategory(
        { workspaceId: "workspace-1", botCategory: "bot" as const },
        false,
      ),
    ).toEqual({ workspaceId: "workspace-1", botCategory: "human" })
  })
})
