import { describe, expect, test } from "vitest"
import { elementToMjml } from "../src/emails/dynamic-template"

describe("elementToMjml", () => {
  test("text converts Enter/newlines to <br /> so paragraphs survive in clients", () => {
    const mjml = elementToMjml({
      type: "text",
      text: "Добрый день!\n\n- Склад\n- Доставка",
    })
    expect(mjml).toContain("Добрый день!<br /><br />- Склад<br />- Доставка")
  })

  test("heading converts newlines to <br />", () => {
    const mjml = elementToMjml({
      type: "heading",
      text: "Line one\nLine two",
    })
    expect(mjml).toContain("Line one<br />Line two")
  })

  test("code converts newlines to <br /> and escapes HTML", () => {
    const mjml = elementToMjml({
      type: "code",
      text: "<script>alert(1)</script>\nnext",
    })
    expect(mjml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;<br />next")
    expect(mjml).not.toContain("<script>")
  })

  test("text escapes HTML so injected tags cannot break the layout", () => {
    const mjml = elementToMjml({
      type: "text",
      text: 'Hello <b>bold</b> & "quoted"',
    })
    expect(mjml).toContain(
      "Hello &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;",
    )
  })
})
