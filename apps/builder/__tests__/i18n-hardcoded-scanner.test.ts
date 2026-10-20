import { describe, expect, test } from "vitest"
import { findHardcodedStrings } from "../scripts/i18n/find-hardcoded"

const scan = (source: string, fileName = "component.tsx") =>
  findHardcodedStrings(fileName, source).map(({ kind, text }) => ({
    kind,
    text,
  }))

describe("findHardcodedStrings", () => {
  test("reports JSX text, text attributes, column properties and toasts", () => {
    const source = `
      const columns = [{ header: "Actions" }]
      export const Example = () => {
        toast.error("Upload failed")
        return <button aria-label="Open menu">Delete   selected</button>
      }
    `

    expect(scan(source)).toEqual([
      { kind: "property", text: "Actions" },
      { kind: "toast", text: "Upload failed" },
      { kind: "attribute", text: "Open menu" },
      { kind: "jsx-text", text: "Delete selected" },
    ])
  })

  test("ignores translated values, non-text attributes and symbols", () => {
    const source = `
      export const Example = ({ t }) => (
        <div className="flex gap-2" title={t("title")} placeholder="—">
          {t("label")} · 42
        </div>
      )
    `

    expect(scan(source)).toEqual([])
  })

  test("parses plain TypeScript files without JSX", () => {
    const source = `const option = { label: "Name", value: "name" }`

    expect(scan(source, "options.ts")).toEqual([
      { kind: "property", text: "Name" },
    ])
  })
})
