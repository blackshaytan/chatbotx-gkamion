"use client"

import { type Ref, useImperativeHandle, useState } from "react"

export type TaskMentionOption = {
  id: string
  kind: "user" | "team"
  label: string
}

export type TaskMentionListRef = {
  onKeyDown: ({ event }: { event: KeyboardEvent }) => boolean
}

type TaskMentionListProps = {
  ref: Ref<TaskMentionListRef>
  items: TaskMentionOption[]
  command: (option: TaskMentionOption) => void
}

export const TaskMentionList = ({
  ref,
  items,
  command,
}: TaskMentionListProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = (index: number) => {
    const option = items[index]
    if (!option) {
      return false
    }
    command(option)
    return true
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) {
        return event.key === "Escape"
      }
      if (event.key === "ArrowUp") {
        setSelectedIndex((index) => (index + items.length - 1) % items.length)
        return true
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((index) => (index + 1) % items.length)
        return true
      }
      if (event.key === "Enter") {
        return selectItem(selectedIndex)
      }
      return event.key === "Escape"
    },
  }))

  return (
    <div className="max-h-60 w-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
      {items.map((option, index) => (
        <button
          className={`w-full rounded px-2 py-1 text-start text-sm hover:bg-accent ${
            index === selectedIndex ? "bg-accent" : ""
          }`}
          key={`${option.kind}:${option.id}`}
          onClick={() => selectItem(index)}
          type="button"
        >
          @{option.label}
        </button>
      ))}
    </div>
  )
}
