import { randomBytes } from "node:crypto"

export const makeDromMessageId = (dialogId: string, messageId: string) =>
  `drom:${dialogId}:${messageId}`

/** DROM returns the new message id with the refreshed dialog; random when it does not. */
export const makeDromOutgoingId = (
  dialogId: string,
  latestMessageId: string | null,
) => `drom-out:${dialogId}:${latestMessageId ?? randomBytes(4).toString("hex")}`
