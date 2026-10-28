export type ChatAgentChannel =
  | { kind: "staff"; title: string }
  | { kind: "token"; id: string; label: string }

const STAFF_CHAT_KEY = /^agent:[0-9]+:staff$/
export const isStaffChatKey = (key: string | null): boolean =>
  STAFF_CHAT_KEY.test(key ?? "")

export const buildDirectKey = (first: string, second: string): string => {
  if (first === second) {
    throw new Error("A direct chat requires two users")
  }
  return BigInt(first) < BigInt(second)
    ? `${first}:${second}`
    : `${second}:${first}`
}

export const buildAgentChatKey = (
  userId: string,
  channel: ChatAgentChannel,
): string => {
  if (channel.kind === "staff") {
    return `agent:${userId}:staff`
  }
  if (!channel.id) {
    throw new Error("Token id is required")
  }
  return `agent:${userId}:token:${channel.id}`
}

export const chatAgentTitle = (channel: ChatAgentChannel): string =>
  channel.kind === "staff" ? channel.title : channel.label.trim()
