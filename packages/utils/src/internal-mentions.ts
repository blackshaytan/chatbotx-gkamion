export const INTERNAL_MENTION_PATTERN =
  /@\[([^\]\n]{1,100})\]\((user|team):(\d{1,20})\)/g

export type InternalMentionSegment =
  | { type: "text"; text: string }
  | { type: "mention"; kind: "user" | "team"; id: string; label: string }

export const parseInternalMentions = (
  text: string,
): { userIds: string[]; teamIds: string[] } => {
  const userIds: string[] = []
  const teamIds: string[] = []
  const seenUsers = new Set<string>()
  const seenTeams = new Set<string>()
  const pattern = new RegExp(INTERNAL_MENTION_PATTERN.source, "g")
  for (const match of text.matchAll(pattern)) {
    const kind = match[2]
    const id = match[3]
    if (!id) {
      continue
    }
    if (kind === "user" && !seenUsers.has(id)) {
      seenUsers.add(id)
      userIds.push(id)
    }
    if (kind === "team" && !seenTeams.has(id)) {
      seenTeams.add(id)
      teamIds.push(id)
    }
  }
  return { userIds, teamIds }
}

export const splitInternalMentionText = (
  text: string,
): InternalMentionSegment[] => {
  const segments: InternalMentionSegment[] = []
  const pattern = new RegExp(INTERNAL_MENTION_PATTERN.source, "g")
  let lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, index) })
    }
    const label = match[1] ?? ""
    const kind = match[2] as "user" | "team"
    const id = match[3] ?? ""
    segments.push({ type: "mention", kind, id, label })
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) })
  }
  if (segments.length === 0) {
    segments.push({ type: "text", text })
  }
  return segments
}
