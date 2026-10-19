import {
  type ButtonStepProps,
  buttonTypes,
  encodeButtonPayload,
} from "@chatbotx.io/flow-config"
import type { MessageButtonTemplate } from "@chatbotx.io/sdk"
import { chunk } from "remeda"
import type { MaxMediaKind } from "../../apis/uploads"
import { MAX_BUTTONS_PER_ROW, MAX_TEXT_LIMIT } from "../../constants"
import type { MaxAttachmentRequest, MaxButton } from "../../schema"

/** One MAX message before media upload: text, media by URL, buttons. */
export type MaxOutgoing = {
  text?: string
  media?: { kind: MaxMediaKind; url: string; filename?: string }[]
  buttons?: MaxButton[]
}

export const splitMaxText = (text: string): string[] => {
  const chunks: string[] = []
  let rest = text
  while (rest.length > MAX_TEXT_LIMIT) {
    const window = rest.slice(0, MAX_TEXT_LIMIT)
    const cut = window.lastIndexOf("\n")
    const end = cut > 0 ? cut + 1 : MAX_TEXT_LIMIT
    chunks.push(rest.slice(0, end).trimEnd())
    rest = rest.slice(end)
  }
  if (rest.length > 0) {
    chunks.push(rest)
  }
  return chunks
}

export const toKeyboard = (
  buttons: MaxButton[],
): MaxAttachmentRequest | undefined =>
  buttons.length === 0
    ? undefined
    : {
        type: "inline_keyboard",
        payload: { buttons: chunk(buttons, MAX_BUTTONS_PER_ROW) },
      }

export const fromFlowButton = (
  flowId: string,
  button: ButtonStepProps,
): MaxButton =>
  button.buttonType === buttonTypes.enum.openWebsite
    ? { type: "link", text: button.label, url: button.beforeStep.url }
    : {
        type: "callback",
        text: button.label,
        payload: encodeButtonPayload({ flowId, buttonId: button.id }),
      }

export const fromTemplateButton = (button: MessageButtonTemplate): MaxButton =>
  button.buttonType === "url"
    ? { type: "link", text: button.label, url: button.url }
    : { type: "callback", text: button.label, payload: button.postback }

/** Long text splits into several messages; media and buttons ride on the last one. */
export const expandText = (outgoing: MaxOutgoing): MaxOutgoing[] => {
  const parts = outgoing.text ? splitMaxText(outgoing.text) : [undefined]
  return parts.map((text, index) =>
    index === parts.length - 1 ? { ...outgoing, text } : { text },
  )
}
