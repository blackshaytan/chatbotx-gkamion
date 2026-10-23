import type { InternalMessageModel } from "@chatbotx.io/database/types"

export type InternalMessageView = Pick<
  InternalMessageModel,
  | "id"
  | "kind"
  | "authorUserId"
  | "authorLabel"
  | "systemEvent"
  | "editedAt"
  | "createdAt"
> & { text: string | null; deleted: boolean }

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
})
