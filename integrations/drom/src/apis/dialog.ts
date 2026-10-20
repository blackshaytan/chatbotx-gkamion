import { DROM_BASE_URL } from "../constants"
import { DromException } from "../exception"
import { createDromClient } from "../lib/http-client"
import { type DromView, parseView } from "../parse"
import type { DromAuthValue } from "../schema"

type RawView = { dialog?: string; header?: string; interlocutor?: string }

const dialogReferer = (dialogId: string) =>
  `${DROM_BASE_URL}/personal/messaging-modal/dialog-${dialogId}`

export const viewDialog = async (
  auth: DromAuthValue,
  dialogId: string,
): Promise<DromView> => {
  const query = new URLSearchParams({
    dialogId,
    json: "true",
    "flat-layout": "false",
    ajax: "1",
  })
  const view = await createDromClient(auth).getJson<RawView>(
    `/personal/messaging/view?${query}`,
    { referer: dialogReferer(dialogId) },
  )
  return parseView(view ?? {})
}

/**
 * Posts one message into a dialog. DROM wants the dialog's latest message id
 * with every send, so the dialog is viewed first. Returns the id of the sent
 * message when DROM answers with the refreshed dialog.
 */
export const sendDromMessage = async (
  auth: DromAuthValue,
  input: { dialogId: string; text: string; imageIds?: string[] },
): Promise<{ latestMessageId: string | null }> => {
  const imageIds = (input.imageIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id && id !== "0")
  if (!(input.text.trim() || imageIds.length)) {
    throw new DromException("DROM message is empty", 400, "emptyMessage")
  }
  const before = await viewDialog(auth, input.dialogId)
  const query = new URLSearchParams({
    dialogId: input.dialogId,
    "flat-layout": "false",
    latestMessageId: before.latestMessageId ?? "",
    ajax: "1",
  })
  const form: Record<string, string> = { message: input.text }
  for (const id of imageIds) {
    form[`images[${id}]`] = "1"
  }
  const response = await createDromClient(auth).postForm<RawView | null>(
    `/personal/messaging/view?${query}`,
    form,
    { referer: dialogReferer(input.dialogId), utfFields: "message" },
  )
  const after = response?.dialog ? parseView(response).latestMessageId : null
  return {
    latestMessageId: after && after !== before.latestMessageId ? after : null,
  }
}
