"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import { useMutation } from "@tanstack/react-query"
import { PaperclipIcon, SendIcon, XIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { orpc } from "@/lib/orpc/query"
import { useInvalidateTasks } from "../hooks/use-invalidate-tasks"
import { extractApiErrorMessage } from "../lib/extract-api-error-message"
import { MentionEditor } from "./mention-editor"

const MAX_FILES = 10
const MAX_FILE_BYTES = 25 * 1024 * 1024

type UploadedAttachment = {
  key: string
  name: string
  size: number
  mimeType: string
}

type CommentComposerProps = {
  taskId: string
  workspaceId: string
  initialText?: string
  onCancel?: () => void
  onSubmitted?: () => void
  onSubmitText?: (text: string) => void
}

export const CommentComposer = ({
  taskId,
  workspaceId,
  initialText = "",
  onCancel,
  onSubmitted,
  onSubmitText,
}: CommentComposerProps) => {
  const t = useTranslations("tasks")
  const commonT = useTranslations()
  const invalidateTasks = useInvalidateTasks()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(initialText)
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([])
  const [editorResetKey, setEditorResetKey] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const uploadMutation = useMutation(
    orpc.tasksAPI.attachments.upload.mutationOptions(),
  )
  const createMutation = useMutation(
    orpc.tasksAPI.comments.create.mutationOptions({
      onError: (error) =>
        toast.error(
          extractApiErrorMessage(error, commonT("messages.unknownError")),
        ),
      onSuccess: async () => {
        setText("")
        setAttachments([])
        setEditorResetKey((current) => current + 1)
        toast.success(t("toasts.commented"))
        await invalidateTasks()
        onSubmitted?.()
      },
    }),
  )

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (files.length === 0) {
      return
    }
    if (attachments.length + files.length > MAX_FILES) {
      toast.error(t("feed.toasts.maxFiles"))
      return
    }
    if (files.some((file) => file.size > MAX_FILE_BYTES)) {
      toast.error(t("feed.toasts.fileTooLarge"))
      return
    }
    setIsUploading(true)
    try {
      const uploaded: UploadedAttachment[] = []
      for (const file of files) {
        uploaded.push(
          await uploadMutation.mutateAsync({ file, id: taskId, workspaceId }),
        )
      }
      setAttachments((current) => [...current, ...uploaded])
    } catch (error) {
      toast.error(
        extractApiErrorMessage(error, commonT("messages.unknownError")),
      )
    } finally {
      setIsUploading(false)
    }
  }

  const handleSubmit = () => {
    const normalizedText = text.trim()
    if (onSubmitText) {
      if (normalizedText) {
        onSubmitText(normalizedText)
      }
      return
    }
    if (
      createMutation.isPending ||
      isUploading ||
      (!normalizedText && attachments.length === 0)
    ) {
      return
    }
    createMutation.mutate({
      id: taskId,
      workspaceId,
      text: normalizedText || undefined,
      attachments: attachments.map(({ key, name }) => ({ key, name })),
    })
  }

  return (
    <div className="space-y-2">
      <MentionEditor
        disabled={createMutation.isPending || isUploading}
        initialText={text}
        onChange={setText}
        onSubmit={handleSubmit}
        placeholder={t("feed.placeholder")}
        resetKey={editorResetKey}
        workspaceId={workspaceId}
      />
      {attachments.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {attachments.map((attachment) => (
            <li className="flex items-center gap-2" key={attachment.key}>
              <span className="truncate">{attachment.name}</span>
              <Button
                aria-label={t("feed.removeAttachment", {
                  name: attachment.name,
                })}
                className="size-6"
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((item) => item.key !== attachment.key),
                  )
                }
                type="button"
                variant="ghost"
              >
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          className="sr-only"
          multiple
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />
        <Button
          aria-label={t("feed.attach")}
          disabled={
            Boolean(onSubmitText) || createMutation.isPending || isUploading
          }
          onClick={() => fileInputRef.current?.click()}
          size="icon"
          type="button"
          variant="outline"
        >
          <PaperclipIcon aria-hidden="true" />
        </Button>
        <Button
          disabled={
            createMutation.isPending ||
            isUploading ||
            (!text.trim() && attachments.length === 0)
          }
          onClick={handleSubmit}
          type="button"
        >
          <SendIcon aria-hidden="true" />
          {isUploading ? t("feed.uploading") : t("actions.comment")}
        </Button>
        {onCancel ? (
          <Button onClick={onCancel} type="button" variant="ghost">
            {commonT("actions.cancel")}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
