"use client"

import Mention from "@tiptap/extension-mention"
import Placeholder from "@tiptap/extension-placeholder"
import { EditorContent, useEditor } from "@tiptap/react"
import { useEffect, useMemo, useRef } from "react"
import { plainTextStarterKit } from "@/components/tiptap/plain-text-tiptap-editor"
import {
  useInboxTeams,
  useWorkspaceMembers,
} from "@/features/users/provider/user-hook"
import type { TaskMentionOption } from "./task-mention-list"
import { taskMentionSuggestion } from "./task-mention-suggestion"

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const escapeHtmlAttribute = (value: string) =>
  escapeHtml(value).replace(/"/g, "&quot;")

const tokenPattern = /@\[([^\]\n]{1,100})\]\((user|team):(\d{1,20})\)/g
const lineBreakPattern = /\r\n?|\n/

export const serializeTaskMentionDocument = (document: {
  content?: Array<{
    type?: string
    text?: string
    attrs?: { id?: string; label?: string }
    content?: unknown[]
  }>
}) => {
  const serializeNode = (node: {
    type?: string
    text?: string
    attrs?: { id?: string; label?: string }
    content?: unknown[]
  }): string => {
    if (node.type === "mention") {
      const [kind, id] = (node.attrs?.id ?? "").split(":")
      const label = node.attrs?.label ?? ""
      return kind === "user" || kind === "team"
        ? `@[${label}](${kind}:${id})`
        : `@${label}`
    }
    if (node.type === "text") {
      return node.text ?? ""
    }
    if (!Array.isArray(node.content)) {
      return ""
    }
    return node.content
      .map((child) => serializeNode(child as typeof node))
      .join("")
  }

  return (document.content ?? []).map((node) => serializeNode(node)).join("\n")
}

export const taskMentionTextToHtml = (value: string) =>
  value
    .split(lineBreakPattern)
    .map((line) => {
      let cursor = 0
      let html = ""
      for (const match of line.matchAll(tokenPattern)) {
        const index = match.index ?? 0
        const label = match[1] ?? ""
        const kind = match[2] ?? ""
        const id = match[3] ?? ""
        html += escapeHtml(line.slice(cursor, index))
        html += `<span data-type="mention" data-id="${escapeHtmlAttribute(`${kind}:${id}`)}" data-label="${escapeHtmlAttribute(label)}"></span>`
        cursor = index + match[0].length
      }
      return `<p>${html}${escapeHtml(line.slice(cursor))}</p>`
    })
    .join("")

type MentionEditorProps = {
  initialText?: string
  onChange: (text: string) => void
  onSubmit: () => void
  placeholder: string
  resetKey?: number
  disabled?: boolean
  workspaceId: string
}

export const MentionEditor = ({
  initialText = "",
  onChange,
  onSubmit,
  placeholder,
  resetKey,
  disabled = false,
  workspaceId,
}: MentionEditorProps) => {
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId)
  const { data: inboxTeams = [] } = useInboxTeams(workspaceId)
  const options = useMemo<TaskMentionOption[]>(
    () => [
      ...workspaceMembers.flatMap((member) =>
        member.user?.name
          ? [
              {
                id: member.userId,
                kind: "user" as const,
                label: member.user.name,
              },
            ]
          : [],
      ),
      ...inboxTeams.map((team) => ({
        id: team.id,
        kind: "team" as const,
        label: team.name,
      })),
    ],
    [inboxTeams, workspaceMembers],
  )
  const optionsRef = useRef(options)
  const previousResetKeyRef = useRef(resetKey)

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const editor = useEditor({
    extensions: [
      plainTextStarterKit,
      Mention.configure({
        renderHTML: ({ node }) => [
          "span",
          {
            "data-id": String(node.attrs.id ?? ""),
            "data-label": String(node.attrs.label ?? ""),
            "data-type": "mention",
            class: "rounded bg-primary/10 px-1 text-primary",
          },
          `@${node.attrs.label ?? ""}`,
        ],
        renderText: ({ node }) => {
          const [kind, id] = String(node.attrs.id ?? "").split(":")
          return `@[${node.attrs.label ?? ""}](${kind}:${id})`
        },
        suggestion: taskMentionSuggestion(() => optionsRef.current),
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: taskMentionTextToHtml(initialText),
    editorProps: {
      attributes: {
        "aria-label": placeholder,
        class:
          "min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          onSubmit()
          return true
        }
        return false
      },
    },
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor: nextEditor }) =>
      onChange(serializeTaskMentionDocument(nextEditor.getJSON())),
  })

  useEffect(() => {
    if (!editor || editor.isFocused) {
      return
    }
    const text = serializeTaskMentionDocument(editor.getJSON())
    if (text !== initialText) {
      editor.commands.setContent(taskMentionTextToHtml(initialText), {
        emitUpdate: false,
      })
    }
  }, [editor, initialText])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    if (
      resetKey === undefined ||
      previousResetKeyRef.current === resetKey ||
      !editor
    ) {
      return
    }
    previousResetKeyRef.current = resetKey
    editor.commands.clearContent(false)
  }, [editor, resetKey])

  return <EditorContent editor={editor} />
}
