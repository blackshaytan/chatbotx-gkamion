export type ChatAgentChannel =
  | { kind: "staff"; title: string }
  | { kind: "token"; label: string }

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
  const label = channel.label.trim()
  if (!label) {
    throw new Error("Token label is required")
  }
  return `agent:${userId}:token:${label}`
}

export const chatAgentTitle = (channel: ChatAgentChannel): string =>
  channel.kind === "staff" ? channel.title : channel.label.trim()
