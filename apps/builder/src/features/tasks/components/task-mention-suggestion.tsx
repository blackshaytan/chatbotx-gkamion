import type { MentionOptions } from "@tiptap/extension-mention"
import { ReactRenderer } from "@tiptap/react"
import tippy, { type Instance } from "tippy.js"
import {
  TaskMentionList,
  type TaskMentionListRef,
  type TaskMentionOption,
} from "./task-mention-list"

export const taskMentionSuggestion = (
  getOptions: () => TaskMentionOption[],
): MentionOptions["suggestion"] => ({
  char: "@",
  items: ({ query }) =>
    getOptions()
      .filter((option) =>
        option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      )
      .slice(0, 8),
  render: () => {
    let component: ReactRenderer
    let popup: Instance | undefined

    return {
      onStart: (props) => {
        component = new ReactRenderer(TaskMentionList, {
          props,
          editor: props.editor,
        })
        popup = tippy(document.body, {
          getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: "bottom-start",
        })
      },
      onUpdate: (props) => {
        component.updateProps(props)
        popup?.setProps({ getReferenceClientRect: props.clientRect })
      },
      onKeyDown: (props) => {
        if (props.event.key === "Escape") {
          popup?.hide()
          return true
        }
        return (
          (component.ref as TaskMentionListRef | null)?.onKeyDown(props) ??
          false
        )
      },
      onExit: () => {
        popup?.destroy()
        component?.destroy()
      },
    }
  },
})
