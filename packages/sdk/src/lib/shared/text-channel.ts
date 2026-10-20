import {
  type ButtonStepProps,
  buttonTypes,
  type SendFileStepSchema,
  type SendImageStepSchema,
  type SendQuickReplyStepSchema,
  type SendTextStepSchema,
  type StepType,
  stepTypes,
} from "@chatbotx.io/flow-config"
import type { SendFlowStepData } from "../flow-step-data"
import type { MessageButtonTemplate } from "./message"

/** A button as a text-only chat can show it: plain text, optionally with a link. */
export type TextChannelButton = { label: string; url?: string }

export type TextChannelMedia = { url: string; filename?: string }

export type TextChannelOutgoing = {
  text?: string
  media?: TextChannelMedia[]
  buttons?: TextChannelButton[]
}

/** Flow steps a text-only chat (ZZAP, DROM) can deliver. */
export const textHandledFlowStepTypes = [
  stepTypes.enum.sendText,
  stepTypes.enum.sendImage,
  stepTypes.enum.sendFile,
  stepTypes.enum.sendQuickReply,
] as const satisfies readonly StepType[]

export const fromFlowButton = (button: ButtonStepProps): TextChannelButton =>
  button.buttonType === buttonTypes.enum.openWebsite
    ? { label: button.label, url: button.beforeStep.url }
    : { label: button.label }

export const fromTemplateButton = (
  button: MessageButtonTemplate,
): TextChannelButton =>
  button.buttonType === "url"
    ? { label: button.label, url: button.url }
    : { label: button.label }

export const flowStepToTextOutgoing = (
  step: SendFlowStepData,
  quickReplies?: MessageButtonTemplate[] | null,
): TextChannelOutgoing => {
  const replies = (quickReplies ?? []).map(fromTemplateButton)
  const withReplies = (buttons: ButtonStepProps[]) => [
    ...buttons.map(fromFlowButton),
    ...replies,
  ]
  switch (step.stepType) {
    case stepTypes.enum.sendText: {
      const s = step as SendTextStepSchema
      return { text: s.text, buttons: withReplies(s.buttons) }
    }
    case stepTypes.enum.sendImage: {
      const s = step as SendImageStepSchema
      return { media: [{ url: s.url }], buttons: withReplies(s.buttons ?? []) }
    }
    case stepTypes.enum.sendFile: {
      const s = step as SendFileStepSchema
      return { media: [{ url: s.url }], buttons: withReplies(s.buttons) }
    }
    case stepTypes.enum.sendQuickReply: {
      const s = step as SendQuickReplyStepSchema
      return { text: s.message, buttons: withReplies(s.buttons) }
    }
    default:
      throw new Error(`Unsupported text channel flow step: ${step.stepType}`)
  }
}

export const messageToTextOutgoing = (
  message: {
    text?: string | null
    attachments?: { url?: string | null; name?: string | null }[] | null
  },
  quickReplies?: MessageButtonTemplate[] | null,
): TextChannelOutgoing => ({
  text: message.text ?? undefined,
  media: (message.attachments ?? []).flatMap((attachment) =>
    attachment.url
      ? [
          {
            url: attachment.url,
            ...(attachment.name ? { filename: attachment.name } : {}),
          },
        ]
      : [],
  ),
  buttons: (quickReplies ?? []).map(fromTemplateButton),
})

const buttonLine = (button: TextChannelButton, index: number): string =>
  button.url
    ? `${index + 1}. ${button.label}: ${button.url}`
    : `${index + 1}. ${button.label}`

export const mediaLine = (item: TextChannelMedia): string =>
  item.filename ? `📎 ${item.filename}\n${item.url}` : item.url

/** Splits at the last line break before `limit`, else hard at `limit`. */
export const splitTextAtLines = (text: string, limit: number): string[] => {
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    const cut = rest.slice(0, limit).lastIndexOf("\n")
    const end = cut > 0 ? cut + 1 : limit
    chunks.push(rest.slice(0, end).trimEnd())
    rest = rest.slice(end)
  }
  if (rest.trim().length > 0) {
    chunks.push(rest)
  }
  return chunks
}

/**
 * Renders a message for a text-only chat: media becomes its link, buttons a
 * numbered list under the text. Returns the texts to send, in order.
 */
export const renderTextOutgoing = (
  outgoing: TextChannelOutgoing,
  limit: number,
): string[] => {
  const blocks = [
    outgoing.text?.trim(),
    ...(outgoing.media ?? []).map(mediaLine),
    (outgoing.buttons ?? []).map(buttonLine).join("\n"),
  ].filter((block): block is string => Boolean(block))
  return blocks.length === 0 ? [] : splitTextAtLines(blocks.join("\n\n"), limit)
}

/** Like {@link renderTextOutgoing} for channels that upload media themselves. */
export const renderTextAndButtons = (
  outgoing: Omit<TextChannelOutgoing, "media">,
  limit: number,
): string[] =>
  renderTextOutgoing({ text: outgoing.text, buttons: outgoing.buttons }, limit)
