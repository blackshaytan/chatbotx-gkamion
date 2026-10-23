import { resolveTenantSettings } from "@chatbotx.io/business"
import { signMediaToken } from "@chatbotx.io/encryption"
import type { z } from "zod"
import type { taskCommentPublicResource } from "../schema/public"

export type TaskCommentPublicResource = z.infer<
  typeof taskCommentPublicResource
>

type CommentAttachmentMeta = {
  index: number
  name: string
  size: number
  mimeType: string
}

type CommentWithAttachmentMeta = {
  id: string
  attachments: readonly CommentAttachmentMeta[]
}

const signAttachmentUrl = async (input: {
  appUrl: string
  workspaceId: string
  commentId: string
  index: number
}): Promise<string> =>
  `${input.appUrl}/media/task-attachment/${await signMediaToken({
    workspaceId: input.workspaceId,
    kind: "taskAttachment",
    refId: `${input.commentId}:${input.index}`,
  })}`

export const withCommentAttachmentUrls = async <
  T extends CommentWithAttachmentMeta,
>(
  workspaceId: string,
  comments: T[],
): Promise<
  Array<
    Omit<T, "attachments"> & {
      attachments: TaskCommentPublicResource["attachments"]
    }
  >
> => {
  const { appUrl } = await resolveTenantSettings({ workspaceId })
  return Promise.all(
    comments.map(async (comment) => ({
      ...comment,
      attachments: await Promise.all(
        comment.attachments.map(async (attachment) => ({
          ...attachment,
          url: await signAttachmentUrl({
            appUrl,
            workspaceId,
            commentId: comment.id,
            index: attachment.index,
          }),
        })),
      ),
    })),
  )
}

export const withSingleCommentAttachmentUrls = async <
  T extends CommentWithAttachmentMeta,
>(
  workspaceId: string,
  comment: T,
): Promise<
  Omit<T, "attachments"> & {
    attachments: TaskCommentPublicResource["attachments"]
  }
> => {
  const [mapped] = await withCommentAttachmentUrls(workspaceId, [comment])
  if (!mapped) {
    throw new Error("Expected one comment")
  }
  return mapped
}
