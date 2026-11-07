import { describe, expect, test } from "vitest"
import {
  CONTACT_AVATAR_PACK_SIZE,
  contactAvatarPackKey,
  isContactAvatarPackKey,
  pickContactAvatarPackKey,
} from "../src/contact-avatar-pack"

describe("contact avatar pack", () => {
  test("keys stay inside the downloaded set", () => {
    expect(contactAvatarPackKey(0)).toBe("contact-avatars/01.svg")
    expect(contactAvatarPackKey(35)).toBe("contact-avatars/36.svg")
    expect(contactAvatarPackKey(36)).toBe("contact-avatars/01.svg")
    expect(contactAvatarPackKey(-1)).toBe("contact-avatars/36.svg")
  })

  test("the same contact id always gets the same picture", () => {
    const first = pickContactAvatarPackKey("11770247250009223")
    expect(pickContactAvatarPackKey("11770247250009223")).toBe(first)
    expect(isContactAvatarPackKey(first)).toBe(true)
    const index = Number(first.slice("contact-avatars/".length, -4))
    expect(index).toBeGreaterThanOrEqual(1)
    expect(index).toBeLessThanOrEqual(CONTACT_AVATAR_PACK_SIZE)
  })

  test("a storage key is not a pack key", () => {
    expect(isContactAvatarPackKey("public/space/1/avatars/abc")).toBe(false)
    expect(isContactAvatarPackKey(null)).toBe(false)
  })
})
