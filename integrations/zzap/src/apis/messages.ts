import { objectParams } from "../lib/fields"
import { createZzapClient } from "../lib/http-client"
import { makeZzapOutgoingId } from "../lib/ids"
import { formatMoscowDate } from "../lib/moscow-time"
import type { ZzapAuthValue, ZzapMessage } from "../schema"

/** Messages of one buyer thread (buyer and shop side). */
export const listMessages = async (
  auth: ZzapAuthValue,
  userKey: string,
): Promise<ZzapMessage[]> => {
  const result = await createZzapClient(auth).get<{ data?: ZzapMessage[] }>(
    `/api/client/v1/messages/${encodeURIComponent(userKey)}`,
    { page: 1, page_size: 100, ...objectParams(auth) },
  )
  return result?.data ?? []
}

/** ZZAP returns no message id, so the id is derived like Geka does. */
export const sendZzapMessage = async (
  auth: ZzapAuthValue,
  input: { userKey: string; text: string; now?: Date },
): Promise<{ messageId: string }> => {
  const messageDate = formatMoscowDate(input.now ?? new Date())
  await createZzapClient(auth).post(
    "/api/client/v1/messages",
    {
      user_key: input.userKey,
      message: input.text,
      message_date: messageDate,
      is_online: false,
    },
    { ...objectParams(auth), test: auth.testMode },
  )
  return {
    messageId: makeZzapOutgoingId({
      userKey: input.userKey,
      messageDate,
      message: input.text,
    }),
  }
}
