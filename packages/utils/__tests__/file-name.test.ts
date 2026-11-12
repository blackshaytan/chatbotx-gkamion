import { describe, expect, test } from "vitest"
import {
  extensionForMimeType,
  filenameWithMimeExtension,
} from "../src/file-name"

describe("filenameWithMimeExtension", () => {
  test("adds an extension when the stored Drom name has none", () => {
    expect(
      filenameWithMimeExtension("1794487538263_default", "image/webp"),
    ).toBe("1794487538263_default.webp")
  })

  test("leaves a name that already has an extension", () => {
    expect(filenameWithMimeExtension("filter.jpg", "image/jpeg")).toBe(
      "filter.jpg",
    )
  })

  test("ignores charset parameters on the mime type", () => {
    expect(
      filenameWithMimeExtension("1_default", "image/jpeg; charset=binary"),
    ).toBe("1_default.jpg")
  })

  test("returns the name when the mime type has no known extension", () => {
    expect(filenameWithMimeExtension("notes", "application/octet-stream")).toBe(
      "notes",
    )
  })
})

describe("extensionForMimeType", () => {
  test("maps jpeg aliases to jpg", () => {
    expect(extensionForMimeType("image/jpg")).toBe("jpg")
    expect(extensionForMimeType("IMAGE/JPEG")).toBe("jpg")
  })
})
