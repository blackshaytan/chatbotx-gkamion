import type { InternalMessageAttachment } from "@chatbotx.io/database/partials"
import { uploader } from "@chatbotx.io/filesystem"
import { createId } from "@chatbotx.io/utils"
import { validationException } from "../errors"
import { logger } from "../logger"

export const TASK_ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxBytes: 25 * 1024 * 1024,
} as const

export const taskAttachmentPrefix = (
  workspaceId: string,
  taskId: string,
): string => `private/space/${workspaceId}/tasks/${taskId}/`

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

export const uploadTaskAttachment = async (input: {
  workspaceId: string
  taskId: string
  file: File
}): Promise<{
  key: string
  name: string
  size: number
  mimeType: string
}> => {
  const { workspaceId, taskId, file } = input
  if (file.size > TASK_ATTACHMENT_LIMITS.maxBytes) {
    throw validationException(
      "file",
      `File must be at most ${TASK_ATTACHMENT_LIMITS.maxBytes} bytes`,
    )
  }
  const key = `${taskAttachmentPrefix(workspaceId, taskId)}${createId()}`
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

export const resolveTaskAttachments = async (input: {
  workspaceId: string
  taskId: string
  items: { key: string; name: string }[]
}): Promise<InternalMessageAttachment[]> => {
  const { workspaceId, taskId, items } = input
  if (items.length > TASK_ATTACHMENT_LIMITS.maxFiles) {
    throw validationException(
      "attachments",
      `At most ${TASK_ATTACHMENT_LIMITS.maxFiles} attachments allowed`,
    )
  }
  const prefix = taskAttachmentPrefix(workspaceId, taskId)
  const resolved: InternalMessageAttachment[] = []
  for (const item of items) {
    if (!item.key.startsWith(prefix)) {
      throw validationException(
        "attachments",
        "Attachment key does not belong to this task",
      )
    }
    let head: { ContentLength?: number; ContentType?: string }
    try {
      head = await uploader.headObject(item.key)
    } catch (err) {
      logger.warn(
        { err, key: item.key, taskId, workspaceId },
        "Task attachment was not found in storage",
      )
      throw validationException(
        "attachments",
        "Attachment not found in storage",
      )
    }
    const size = head.ContentLength ?? 0
    if (size > TASK_ATTACHMENT_LIMITS.maxBytes) {
      throw validationException(
        "attachments",
        `Attachment exceeds ${TASK_ATTACHMENT_LIMITS.maxBytes} bytes`,
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
