import type {
  InternalMessageAttachment,
  InternalMessageMentions,
} from "@chatbotx.io/database/partials"
import type { InternalMessageModel } from "@chatbotx.io/database/types"

export type InternalMessageAttachmentView = {
  index: number
  name: string
  size: number
  mimeType: string
}

export type InternalMessageView = Pick<
  InternalMessageModel,
  | "id"
  | "kind"
  | "authorUserId"
  | "authorLabel"
  | "systemEvent"
  | "editedAt"
  | "createdAt"
> & {
  text: string | null
  deleted: boolean
  mentions: InternalMessageMentions
  attachments: InternalMessageAttachmentView[]
}

const toAttachmentViews = (
  attachments: InternalMessageAttachment[],
): InternalMessageAttachmentView[] =>
  attachments.map((attachment, index) => ({
    index,
    name: attachment.name,
    size: attachment.size,
    mimeType: attachment.mimeType,
  }))

export const toInternalMessageView = (
  message: InternalMessageModel,
): InternalMessageView => ({
  id: message.id,
  kind: message.kind,
  authorUserId: message.authorUserId,
  authorLabel: message.authorLabel,
  text: message.deletedAt ? null : message.text,
  systemEvent: message.systemEvent,
  editedAt: message.editedAt,
  createdAt: message.createdAt,
  deleted: message.deletedAt !== null,
  mentions: message.deletedAt ? { userIds: [], teamIds: [] } : message.mentions,
  attachments: message.deletedAt ? [] : toAttachmentViews(message.attachments),
})
