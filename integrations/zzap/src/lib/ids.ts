import { createHash } from "node:crypto"

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex")

/** Same formula as Geka (`make_zzap_external_id`), so ids match its history. */
export const makeZzapMessageId = (input: {
  userKey: string
  messageDate: string
  senderKey: string
  message: string
}): string =>
  `zzap:${sha256Hex(
    `${input.userKey}|${input.messageDate}|${input.senderKey}|${input.message}`,
  ).slice(0, 24)}`

export const makeZzapOutgoingId = (input: {
  userKey: string
  messageDate: string
  message: string
}): string =>
  `zzap-out:${sha256Hex(
    `${input.userKey}|${input.messageDate}|${input.message}`,
  ).slice(0, 16)}`
