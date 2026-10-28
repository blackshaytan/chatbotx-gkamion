"use client"

import { plainTextStarterKit } from "@/components/tiptap/plain-text-tiptap-editor"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import Placeholder from "@tiptap/extension-placeholder"
import { EditorContent, useEditor } from "@tiptap/react"
import { useMutation } from "@tanstack/react-query"
import { PaperclipIcon, SendIcon, XIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useRef, useState } from "react"
import { orpc } from "@/lib/orpc/query"
import { useInvalidateChats } from "../hooks/use-invalidate-chats"

const MAX_FILES = 10
const MAX_FILE_BYTES = 25 * 1024 * 1024

type Attachment = { key: string; name: string }

export const ChatComposer = ({
  chatId,
  disabled = false,
  workspaceId,
}: {
  chatId: string
  disabled?: boolean
  workspaceId: string
}) => {
  const t = useTranslations()
  const invalidateChats = useInvalidateChats()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const upload = useMutation(
    orpc.chatsAPI.attachments.upload.mutationOptions(),
  )
  const send = useMutation(
    orpc.chatsAPI.messages.create.mutationOptions({
      onSuccess: async () => {
        editor?.commands.clearContent()
        setAttachments([])
        await invalidateChats()
      },
    }),
  )
  const submit = () => {
    const message = text.trim()
    if (disabled || isUploading || send.isPending || (!message && !attachments.length)) {
      return
    }
    send.mutate({
      attachments: attachments.length ? attachments : undefined,
      id: chatId,
      text: message || undefined,
      workspaceId,
    })
  }
  const editor = useEditor({
    content: "",
    editable: !(disabled || isUploading || send.isPending),
    extensions: [
      plainTextStarterKit,
      Placeholder.configure({ placeholder: t("actions.messagePlaceholder") }),
    ],
    editorProps: {
      attributes: {
        "aria-label": t("actions.messagePlaceholder"),
        class:
          "min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault()
          submit()
          return true
        }
        return false
      },
    },
    immediatelyRender: false,
    onUpdate: ({ editor: nextEditor }) => setText(nextEditor.getText()),
  })
  useEffect(() => {
    editor?.setEditable(!(disabled || isUploading || send.isPending))
  }, [disabled, editor, isUploading, send.isPending])
  const uploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (
      !files.length ||
      files.length + attachments.length > MAX_FILES ||
      files.some((file) => file.size > MAX_FILE_BYTES)
    ) {
      return
    }
    setIsUploading(true)
    try {
      const uploaded = await Promise.all(
        files.map((file) => upload.mutateAsync({ file, id: chatId, workspaceId })),
      )
      setAttachments((current) => [
        ...current,
        ...uploaded.map(({ key, name }) => ({ key, name })),
      ])
    } finally {
      setIsUploading(false)
    }
  }
  return (
    <div className="space-y-2 border-t p-3">
      <EditorContent editor={editor} />
      {attachments.length ? (
        <div className="flex flex-wrap gap-2 text-sm">
          {attachments.map((attachment) => (
            <span className="flex items-center gap-1 rounded border px-2 py-1" key={attachment.key}>
              {attachment.name}
              <Button aria-label={t("actions.delete")} className="size-5" onClick={() => setAttachments((current) => current.filter((item) => item.key !== attachment.key))} size="icon" type="button" variant="ghost">
                <XIcon aria-hidden="true" />
              </Button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <input className="sr-only" multiple onChange={uploadFiles} ref={fileInputRef} type="file" />
        <Button aria-label={t("actions.uploadFile")} disabled={disabled || isUploading || send.isPending} onClick={() => fileInputRef.current?.click()} size="icon" type="button" variant="outline">
          <PaperclipIcon aria-hidden="true" />
        </Button>
        <Button disabled={disabled || isUploading || send.isPending || (!text.trim() && !attachments.length)} onClick={submit} type="button">
          <SendIcon aria-hidden="true" />
          {t("actions.send")}
        </Button>
      </div>
    </div>
  )
}
