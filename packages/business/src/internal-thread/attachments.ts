import type { InternalMessageAttachment } from "@chatbotx.io/database/partials"
import { uploader } from "@chatbotx.io/filesystem"
import { createId } from "@chatbotx.io/utils"
import { validationException } from "../errors"

export const TASK_ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxBytes: 25 * 1024 * 1024,
} as const

export const taskAttachmentPrefix = (
  workspaceId: string,
  taskId: string,
): string => `private/space/${workspaceId}/tasks/${taskId}/`

const sanitizeAttachmentName = (name: string): string =>
  name.replaceAll(/[/\\]/g, "").slice(0, 255)

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
  const buffer = (await file.arrayBuffer()) as unknown as Buffer
  const mimeType = file.type || "application/octet-stream"
  await uploader.putObject(key, buffer, {
    ContentLength: file.size,
    ContentType: mimeType,
    ContentDisposition: `attachment; filename="${sanitizeAttachmentName(file.name)}"`,
  })
  return {
    key,
    name: file.name,
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
    } catch {
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
