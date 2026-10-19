import { createMaxClient } from "../lib/http-client"

export type MaxBotInfo = {
  user_id: number
  name?: string
  first_name?: string
  username?: string | null
}

export const getMe = async (token: string): Promise<MaxBotInfo> =>
  await createMaxClient(token).get<MaxBotInfo>("me")

export const sendTypingOn = async (token: string, chatId: string) =>
  await createMaxClient(token).post(`chats/${chatId}/actions`, {
    json: { action: "typing_on" },
  })
