import { type ButtonStepProps, buttonTypes } from "@chatbotx.io/flow-config"
import type { MessageButtonTemplate } from "@chatbotx.io/sdk"
import { ZZAP_TEXT_LIMIT } from "../../constants"

/** A button as ZZAP can show it: plain text, optionally with a link. */
export type ZzapTextButton = { label: string; url?: string }

export type ZzapOutgoing = {
  text?: string
  media?: { url: string; filename?: string }[]
  buttons?: ZzapTextButton[]
}

export const fromFlowButton = (button: ButtonStepProps): ZzapTextButton =>
  button.buttonType === buttonTypes.enum.openWebsite
    ? { label: button.label, url: button.beforeStep.url }
    : { label: button.label }

export const fromTemplateButton = (
  button: MessageButtonTemplate,
): ZzapTextButton =>
  button.buttonType === "url"
    ? { label: button.label, url: button.url }
    : { label: button.label }

const buttonLine = (button: ZzapTextButton, index: number): string =>
  button.url
    ? `${index + 1}. ${button.label}: ${button.url}`
    : `${index + 1}. ${button.label}`

/** Splits at the last line break before the limit, else hard at the limit. */
export const splitZzapText = (text: string): string[] => {
  const chunks: string[] = []
  let rest = text
  while (rest.length > ZZAP_TEXT_LIMIT) {
    const window = rest.slice(0, ZZAP_TEXT_LIMIT)
    const cut = window.lastIndexOf("\n")
    const end = cut > 0 ? cut + 1 : ZZAP_TEXT_LIMIT
    chunks.push(rest.slice(0, end).trimEnd())
    rest = rest.slice(end)
  }
  if (rest.trim().length > 0) {
    chunks.push(rest)
  }
  return chunks
}

/**
 * ZZAP chat is text only: media becomes its URL, buttons a numbered list
 * under the text. Returns the texts to send, in order.
 */
export const toZzapTexts = (outgoing: ZzapOutgoing): string[] => {
  const blocks = [
    outgoing.text?.trim(),
    ...(outgoing.media ?? []).map((item) =>
      item.filename ? `📎 ${item.filename}\n${item.url}` : item.url,
    ),
    (outgoing.buttons ?? []).map(buttonLine).join("\n"),
  ].filter((block): block is string => Boolean(block))
  return blocks.length === 0 ? [] : splitZzapText(blocks.join("\n\n"))
}
