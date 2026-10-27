import type { InternalMessageAttachment } from "@chatbotx.io/database/partials"
import { uploader } from "@chatbotx.io/filesystem"
import { createId } from "@chatbotx.io/utils"
import { validationException } from "../errors"
import { logger } from "../logger"

export const THREAD_ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxBytes: 25 * 1024 * 1024,
} as const

export const TASK_ATTACHMENT_LIMITS = THREAD_ATTACHMENT_LIMITS
type ThreadAttachmentOwner = { kind: "tasks" | "chats"; id: string }
export const threadAttachmentPrefix = (
  workspaceId: string,
  owner: ThreadAttachmentOwner,
) => `private/space/${workspaceId}/${owner.kind}/${owner.id}/`
export const chatAttachmentPrefix = (workspaceId: string, threadId: string) =>
  threadAttachmentPrefix(workspaceId, { kind: "chats", id: threadId })

export const taskAttachmentPrefix = (
  workspaceId: string,
  taskId: string,
): string => threadAttachmentPrefix(workspaceId, { kind: "tasks", id: taskId })

const FORBIDDEN_NAME_CHARACTERS = new Set(["/", "\\", '"'])

const isAllowedNameCharacter = (character: string): boolean => {
  const code = character.charCodeAt(0)
  return code >= 32 && code !== 127 && !FORBIDDEN_NAME_CHARACTERS.has(character)
}

const sanitizeAttachmentName = (name: string): string =>
  Array.from(name)
    .filter(isAllowedNameCharacter)
    .join("")
    .trim()
    .slice(0, 255) || "file"

const attachmentOwnerName = (owner: ThreadAttachmentOwner): string =>
  owner.kind === "tasks" ? "task" : "chat"

export const uploadThreadAttachment = async (input: {
  workspaceId: string
  owner: ThreadAttachmentOwner
  file: File
}): Promise<{
  key: string
  name: string
  size: number
  mimeType: string
}> => {
  const { workspaceId, owner, file } = input
  if (file.size > THREAD_ATTACHMENT_LIMITS.maxBytes) {
    throw validationException(
      "file",
      `File must be at most ${THREAD_ATTACHMENT_LIMITS.maxBytes} bytes`,
    )
  }
  const key = `${threadAttachmentPrefix(workspaceId, owner)}${createId()}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const name = sanitizeAttachmentName(file.name)
  const mimeType = file.type || "application/octet-stream"
  await uploader.putObject(key, buffer, {
    ContentLength: file.size,
    ContentType: mimeType,
    ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
  })
  return {
    key,
    name,
    size: file.size,
    mimeType,
  }
}

export const resolveThreadAttachments = async (input: {
  workspaceId: string
  owner: ThreadAttachmentOwner
  items: { key: string; name: string }[]
}): Promise<InternalMessageAttachment[]> => {
  const { workspaceId, owner, items } = input
  if (items.length > THREAD_ATTACHMENT_LIMITS.maxFiles) {
    throw validationException(
      "attachments",
      `At most ${THREAD_ATTACHMENT_LIMITS.maxFiles} attachments allowed`,
    )
  }
  const prefix = threadAttachmentPrefix(workspaceId, owner)
  const resolved: InternalMessageAttachment[] = []
  for (const item of items) {
    if (!item.key.startsWith(prefix)) {
      throw validationException(
        "attachments",
        `Attachment key does not belong to this ${attachmentOwnerName(owner)}`,
      )
    }
    let head: { ContentLength?: number; ContentType?: string }
    try {
      head = await uploader.headObject(item.key)
    } catch (err) {
      logger.warn(
        {
          err,
          key: item.key,
          ownerId: owner.id,
          ownerKind: owner.kind,
          workspaceId,
        },
        "Thread attachment was not found in storage",
      )
      throw validationException(
        "attachments",
        "Attachment not found in storage",
      )
    }
    const size = head.ContentLength ?? 0
    if (size > THREAD_ATTACHMENT_LIMITS.maxBytes) {
      throw validationException(
        "attachments",
        `Attachment exceeds ${THREAD_ATTACHMENT_LIMITS.maxBytes} bytes`,
      )
    }
    resolved.push({
      key: item.key,
      name: sanitizeAttachmentName(item.name),
      size,
      mimeType: head.ContentType ?? "application/octet-stream",
    })
  }
  return resolved
}

export const uploadTaskAttachment = async (input: {
  workspaceId: string
  taskId: string
  file: File
}) =>
  await uploadThreadAttachment({
    workspaceId: input.workspaceId,
    owner: { kind: "tasks", id: input.taskId },
    file: input.file,
  })

export const resolveTaskAttachments = async (input: {
  workspaceId: string
  taskId: string
  items: { key: string; name: string }[]
}) =>
  await resolveThreadAttachments({
    workspaceId: input.workspaceId,
    owner: { kind: "tasks", id: input.taskId },
    items: input.items,
  })

export const uploadChatAttachment = async (input: {
  workspaceId: string
  threadId: string
  file: File
}) =>
  await uploadThreadAttachment({
    workspaceId: input.workspaceId,
    owner: { kind: "chats", id: input.threadId },
    file: input.file,
  })

export const resolveChatAttachments = async (input: {
  workspaceId: string
  threadId: string
  items: { key: string; name: string }[]
}) =>
  await resolveThreadAttachments({
    workspaceId: input.workspaceId,
    owner: { kind: "chats", id: input.threadId },
    items: input.items,
  })
