import { MaxAPIException } from "../exception"
import { createMaxClient } from "../lib/http-client"
import type { MaxNewMessageBody } from "../schema"

type SendResult = { message: { body: { mid: string } } }

const ATTACHMENT_NOT_READY = "attachment.not.ready"
const NOT_READY_RETRIES = 3
const NOT_READY_DELAY_MS = 1000

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Sends one message to a user; retries while an uploaded file is still processing. */
export const sendMaxMessage = async (props: {
  token: string
  userId: string
  body: MaxNewMessageBody
}): Promise<string> => {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await createMaxClient(props.token).post<SendResult>(
        "messages",
        { searchParams: { user_id: props.userId }, json: props.body },
      )
      return result.message.body.mid
    } catch (error) {
      const notReady =
        error instanceof MaxAPIException &&
        error.code === ATTACHMENT_NOT_READY &&
        attempt < NOT_READY_RETRIES
      if (!notReady) {
        throw error
      }
      await sleep(NOT_READY_DELAY_MS)
    }
  }
}
