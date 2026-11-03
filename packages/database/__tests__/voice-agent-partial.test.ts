import { describe, expect, it } from "vitest"
import { aiCallOptOutSourceSchema } from "../src/partials/voice-agent"
import { workspaceApiTokenScopes } from "../src/partials/workspace-api-token"

describe("voice agent partials", () => {
  it("источник отказа — только три значения", () => {
    expect(aiCallOptOutSourceSchema.options).toEqual([
      "clientCall",
      "clientChat",
      "manager",
    ])
    expect(aiCallOptOutSourceSchema.safeParse("import").success).toBe(false)
  })

  it("voiceAgent — скоуп токена", () => {
    expect(workspaceApiTokenScopes.safeParse("voiceAgent").success).toBe(true)
    expect(workspaceApiTokenScopes.options.at(-1)).toBe("voiceAgent")
  })
})
