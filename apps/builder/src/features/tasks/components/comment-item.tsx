"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@chatbotx.io/ui/components/ui/alert-dialog"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chatbotx.io/ui/components/ui/dropdown-menu"
import { splitInternalMentionText } from "@chatbotx.io/utils"
import { useMutation } from "@tanstack/react-query"
import { MoreVerticalIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { useState } from "react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth/auth-client"
import { orpc } from "@/lib/orpc/query"
import { useInvalidateTasks } from "../hooks/use-invalidate-tasks"
import { extractApiErrorMessage } from "../lib/extract-api-error-message"
import { CommentAttachments } from "./comment-attachments"
import { CommentComposer } from "./comment-composer"

type CommentItemProps = {
  comment: {
    attachments: Array<{
      index: number
      mimeType: string
      name: string
      size: number
      url: string
    }>
    authorLabel: string | null
    authorUserId: string | null
    createdAt: Date
    deleted: boolean
    editedAt: Date | null
    id: string
    text: string | null
  }
  taskId: string
  workspaceId: string
}

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000

export const CommentItem = ({
  comment,
  taskId,
  workspaceId,
}: CommentItemProps) => {
  const t = useTranslations("tasks")
  const commonT = useTranslations()
  const formatter = useFormatter()
  const { data: session } = authClient.useSession()
  const invalidateTasks = useInvalidateTasks()
  const [isEditing, setIsEditing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const isOwnComment = comment.authorUserId === session?.user.id
  const isWithinEditWindow =
    Date.now() - new Date(comment.createdAt).getTime() < EDIT_WINDOW_MS
  const canEdit = !comment.deleted && isOwnComment && isWithinEditWindow
  const canDelete = canEdit
  const updateMutation = useMutation(
    orpc.tasksAPI.comments.update.mutationOptions({
      onError: (error) =>
        toast.error(
          extractApiErrorMessage(error, commonT("messages.unknownError")),
        ),
      onSuccess: async () => {
        setIsEditing(false)
        toast.success(t("toasts.commentUpdated"))
        await invalidateTasks()
      },
    }),
  )
  const deleteMutation = useMutation(
    orpc.tasksAPI.comments.delete.mutationOptions({
      onError: (error) =>
        toast.error(
          extractApiErrorMessage(error, commonT("messages.unknownError")),
        ),
      onSuccess: async () => {
        setIsDeleting(false)
        toast.success(t("toasts.commentDeleted"))
        await invalidateTasks()
      },
    }),
  )

  const handleUpdate = (text: string) => {
    const value = text.trim()
    if (!value || updateMutation.isPending) {
      return
    }
    updateMutation.mutate({
      id: taskId,
      commentId: comment.id,
      text: value,
      workspaceId,
    })
  }
  const commentContent = (() => {
    if (comment.deleted) {
      return (
        <p className="text-muted-foreground text-sm">{t("feed.deleted")}</p>
      )
    }
    if (isEditing) {
      return (
        <CommentComposer
          initialText={comment.text ?? ""}
          onCancel={() => setIsEditing(false)}
          onSubmitText={handleUpdate}
          taskId={taskId}
          workspaceId={workspaceId}
        />
      )
    }
    return (
      <>
        <p className="whitespace-pre-wrap text-sm">
          {splitInternalMentionText(comment.text ?? "").map(
            (segment, index) => {
              const segmentKey = `segment-${index}`
              return segment.type === "mention" ? (
                <span
                  className="rounded bg-primary/10 px-1 text-primary"
                  key={segmentKey}
                >
                  @{segment.label}
                </span>
              ) : (
                <span key={segmentKey}>{segment.text}</span>
              )
            },
          )}
        </p>
        <CommentAttachments attachments={comment.attachments} />
      </>
    )
  })()

  return (
    <article className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">
          {comment.authorLabel ?? t("hidden")}
        </span>
        <div className="flex items-center gap-2 text-muted-foreground">
          <time>
            {formatter.dateTime(comment.createdAt, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
          {comment.editedAt ? <span>{t("feed.edited")}</span> : null}
          {canEdit || canDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label={commonT("actions.openMenu")}
                    className="size-6"
                    variant="ghost"
                  >
                    <MoreVerticalIcon aria-hidden="true" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {canEdit ? (
                  <DropdownMenuItem onClick={() => setIsEditing(true)}>
                    {commonT("actions.edit")}
                  </DropdownMenuItem>
                ) : null}
                {canDelete ? (
                  <DropdownMenuItem
                    onClick={() => setIsDeleting(true)}
                    variant="destructive"
                  >
                    {commonT("actions.delete")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      {commentContent}
      <AlertDialog onOpenChange={setIsDeleting} open={isDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{commonT("actions.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("feed.deleteCommentConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{commonT("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteMutation.mutate({
                  id: taskId,
                  commentId: comment.id,
                  workspaceId,
                })
              }
            >
              {commonT("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
