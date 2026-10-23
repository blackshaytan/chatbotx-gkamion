import type { TaskSystemEvent } from "@chatbotx.io/database/partials"
import { inboxTeamMemberRepository } from "@chatbotx.io/database/repositories"
import type { TaskNotificationActionEvent } from "../notification/recipients"
import type { TaskAssignee } from "./types"

const unique = (ids: string[]): string[] => [...new Set(ids)]

export const listAssigneeUserIds = async (input: {
  workspaceId: string
  assigneeUserId: string | null
  assigneeTeamId: string | null
}): Promise<string[]> => {
  if (input.assigneeUserId) {
    return [input.assigneeUserId]
  }
  if (!input.assigneeTeamId) {
    return []
  }
  return await inboxTeamMemberRepository.listUserIdsByTeamId({
    workspaceId: input.workspaceId,
    inboxTeamId: input.assigneeTeamId,
  })
}

export const expandMentionUserIds = async (input: {
  workspaceId: string
  userIds: string[]
  teamIds: string[]
}): Promise<string[]> => {
  const ids = [...input.userIds]
  for (const teamId of input.teamIds) {
    const teamUserIds = await inboxTeamMemberRepository.listUserIdsByTeamId({
      workspaceId: input.workspaceId,
      inboxTeamId: teamId,
    })
    ids.push(...teamUserIds)
  }
  return unique(ids)
}

const parseAssigneeToken = (token: string): TaskAssignee | null => {
  if (token.startsWith("user:")) {
    return { type: "user", userId: token.slice("user:".length) }
  }
  if (token.startsWith("team:")) {
    return { type: "team", teamId: token.slice("team:".length) }
  }
  return null
}

export const buildNotifyEventsFromChanges = async (input: {
  workspaceId: string
  events: TaskSystemEvent[]
}): Promise<TaskNotificationActionEvent[]> => {
  const { workspaceId, events } = input
  const notifyEvents: TaskNotificationActionEvent[] = []

  for (const event of events) {
    if (event.type === "assignee" && event.to) {
      const assignee = parseAssigneeToken(event.to)
      if (assignee) {
        const userIds =
          assignee.type === "user"
            ? [assignee.userId]
            : await inboxTeamMemberRepository.listUserIdsByTeamId({
                workspaceId,
                inboxTeamId: assignee.teamId,
              })
        if (userIds.length > 0) {
          notifyEvents.push({ kind: "assigned", userIds })
        }
      }
      continue
    }
    if (event.type === "status") {
      notifyEvents.push({ kind: "statusChanged" })
      continue
    }
    if (event.type === "due") {
      notifyEvents.push({ kind: "dueChanged" })
    }
  }

  return notifyEvents
}

export const pickStatusChangeBounds = (
  events: TaskSystemEvent[],
): { from: string | null; to: string | null } | null => {
  const statusEvent = events.find((event) => event.type === "status")
  if (statusEvent?.type !== "status") {
    return null
  }
  return { from: statusEvent.from, to: statusEvent.to }
}

export const pickDueChangeBounds = (
  events: TaskSystemEvent[],
): { from: string | null; to: string | null } | null => {
  const dueEvent = events.find((event) => event.type === "due")
  if (dueEvent?.type !== "due") {
    return null
  }
  return { from: dueEvent.from, to: dueEvent.to }
}
