import { z } from "zod"
import { esc } from "./base-template"

export const mailElementTypes = z.enum([
  "heading",
  "text",
  "image",
  "button",
  "spacing",
  "code",
  "line",
])
export type MailElementType = z.infer<typeof mailElementTypes>

export const mailElementSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.enum([
      mailElementTypes.enum.heading,
      mailElementTypes.enum.text,
      mailElementTypes.enum.code,
    ]),
    text: z.string(),
  }),
  z.object({
    type: z.enum([mailElementTypes.enum.image]),
    url: z.string().optional(),
  }),
  z.object({
    type: z.enum([mailElementTypes.enum.line, mailElementTypes.enum.spacing]),
  }),
  z.object({
    type: z.literal(mailElementTypes.enum.button),
    label: z.string().optional(),
    url: z.string().optional(),
  }),
])
export type MailElementSchema = z.infer<typeof mailElementSchema>

export const elements = z.array(mailElementSchema)

export type DynamicEmailProps = {
  brandName: string
  subject: string
  preheader: string
  elements: MailElementSchema[]
}

/**
 * Escape text and keep Enter/newlines as hard breaks for email clients.
 * Also joins a lone `-` / `•` / `*` line with the next line so TipTap bullet
 * drafts like `-\nСклад и скорость: …` render as one bullet line.
 */
const textWithBreaks = (text: string): string =>
  esc(text)
    .replace(/(^|\n)([-•*])\n(?=\S)/g, "$1$2 ")
    .replace(/\n/g, "<br />")

/** Shared left-aligned section wrapper — full-width so Gmail does not park a 600px column in the middle of a wide pane. */
const section = (inner: string, padding = "0 0 12px 0"): string => `
        <mj-section padding="${padding}" full-width="full-width">
          <mj-column width="100%" padding="0">
            ${inner}
          </mj-column>
        </mj-section>`

export function elementToMjml(element: MailElementSchema): string {
  switch (element.type) {
    // TipTap stores Enter as `\n` (getText blockSeparator). HTML collapses
    // those newlines, so every text-like block must emit `<br />` — otherwise
    // a multi-paragraph email body renders as one continuous run in Gmail/etc.
    case "heading":
      return section(`
            <mj-raw>
              <div style="font-size:20px;font-weight:700;color:#1d1c1d;line-height:28px;text-align:left;padding:0;">
                ${textWithBreaks(element.text)}
              </div>
            </mj-raw>`)

    case "text":
      return section(`
            <mj-raw>
              <div style="font-size:15px;color:#222222;line-height:22px;text-align:left;padding:0;font-family:Arial,Helvetica,sans-serif;">
                ${textWithBreaks(element.text)}
              </div>
            </mj-raw>`)

    case "code":
      return section(`
            <mj-raw>
              <div style="font-family:monospace,'Courier New';font-size:14px;color:#3c3f44;line-height:22px;background-color:#f4f4f5;padding:12px;text-align:left;">
                ${textWithBreaks(element.text)}
              </div>
            </mj-raw>`)

    case "image":
      return element.url
        ? section(
            `<mj-image src="${esc(element.url)}" alt="" align="left" padding="0" />`,
          )
        : ""

    case "button":
      return element.url
        ? section(`
            <mj-button align="left" background-color="#111111" color="#ffffff" font-size="14px"
              font-weight="700" border-radius="4px" href="${esc(element.url)}">
              ${esc(element.label ?? "Click here")}
            </mj-button>`)
        : ""

    case "line":
      return section(
        `<mj-divider border-color="#e8e8e8" border-width="1px" padding="8px 0" />`,
        "0",
      )

    case "spacing":
      return section(`<mj-spacer height="12px" />`, "0")

    default:
      return ""
  }
}

export function buildMjmlTemplate(props: DynamicEmailProps): string {
  const { elements: els } = props
  const bodyElements = els.map(elementToMjml).join("\n")

  // mj-body only accepts px widths (not %). Use a wide px body, then CSS
  // forces left alignment and stretches to the client pane so Gmail does not
  // park a centered 600px marketing column in the middle of a wide window.
  return `
    <mjml>
      <mj-head>
        <mj-preview>
          ${esc(props.preheader)}
        </mj-preview>
        <mj-attributes>
          <mj-all font-family="Arial, Helvetica, sans-serif" />
          <mj-text align="left" />
          <mj-section padding="0" />
          <mj-column padding="0" />
        </mj-attributes>
        <mj-style>
          body { margin: 0 !important; padding: 0 !important; }
          .mj-container { width: 100% !important; max-width: 100% !important; margin: 0 !important; }
          div[style*="margin:0px auto"] { margin: 0 !important; max-width: 100% !important; width: 100% !important; }
        </mj-style>
      </mj-head>
      <mj-body width="960px" background-color="#ffffff">
        ${bodyElements}
      </mj-body>
    </mjml>
  `
}
