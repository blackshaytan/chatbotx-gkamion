import type { InternalMessageModel } from "@chatbotx.io/database/types"
import type { TaskActor } from "../task/actor"

const COMMENT_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000

type CommentMessage = Pick<
  InternalMessageModel,
  "kind" | "authorUserId" | "authorLabel" | "deletedAt" | "createdAt"
>

const isWithinEditWindow = (createdAt: Date, now: Date): boolean =>
  now.getTime() - createdAt.getTime() < COMMENT_EDIT_WINDOW_MS

export const canEditComment = (input: {
  message: CommentMessage
  actor: TaskActor
  now: Date
}): boolean => {
  const { message, actor, now } = input
  if (message.kind !== "comment" || message.deletedAt) {
    return false
  }
  if (actor.kind === "api" || actor.kind === "flow") {
    return message.authorUserId === null && message.authorLabel === actor.label
  }
  return (
    message.authorUserId === actor.userId &&
    isWithinEditWindow(message.createdAt, now)
  )
}

export const canDeleteComment = (input: {
  message: CommentMessage
  actor: TaskActor
  isOwner: boolean
  now: Date
}): boolean => {
  const { message, actor, isOwner, now } = input
  if (message.kind !== "comment" || message.deletedAt) {
    return false
  }
  if (actor.kind === "api" || actor.kind === "flow") {
    return true
  }
  if (isOwner) {
    return true
  }
  return (
    message.authorUserId === actor.userId &&
    isWithinEditWindow(message.createdAt, now)
  )
}
