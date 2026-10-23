import {
  EMPTY_INTERNAL_MESSAGE_MENTIONS,
  type TaskSystemEvent,
} from "@chatbotx.io/database/partials"
import type { InternalMessageInsert } from "@chatbotx.io/database/repositories"
import { actorLabel, actorUserId, type TaskActor } from "../task/actor"

export const commentRow = (input: {
  workspaceId: string
  threadId: string
  text: string
  actor: TaskActor
}): InternalMessageInsert => ({
  workspaceId: input.workspaceId,
  threadId: input.threadId,
  kind: "comment",
  authorUserId: actorUserId(input.actor),
  authorLabel: actorLabel(input.actor),
  text: input.text,
  mentions: EMPTY_INTERNAL_MESSAGE_MENTIONS,
  attachments: [],
  systemEvent: null,
})

export const systemMessageRow = (input: {
  workspaceId: string
  threadId: string
  event: TaskSystemEvent
  authorLabel: string | null
}): InternalMessageInsert => ({
  workspaceId: input.workspaceId,
  threadId: input.threadId,
  kind: "system",
  authorUserId: input.event.byUserId,
  authorLabel: input.authorLabel,
  text: null,
  mentions: EMPTY_INTERNAL_MESSAGE_MENTIONS,
  attachments: [],
  systemEvent: input.event,
})
