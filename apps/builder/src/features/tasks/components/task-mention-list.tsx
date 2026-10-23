"use client"

import { type Ref, useEffect, useImperativeHandle, useState } from "react"

export type TaskMentionOption = {
  id: string
  kind: "user" | "team"
  label: string
}

export type TaskMentionListRef = {
  onKeyDown: ({ event }: { event: KeyboardEvent }) => boolean
}

export type TaskMentionAttributes = {
  id: string
  label: string
}

type TaskMentionListProps = {
  ref: Ref<TaskMentionListRef>
  items: TaskMentionOption[]
  command: (attrs: TaskMentionAttributes) => void
}

export const toTaskMentionAttributes = (
  option: TaskMentionOption,
): TaskMentionAttributes => ({
  id: `${option.kind}:${option.id}`,
  label: option.label.replaceAll("]", "").slice(0, 100),
})

export const TaskMentionList = ({
  ref,
  items,
  command,
}: TaskMentionListProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const itemIds = items.map((item) => `${item.kind}:${item.id}`).join(",")

  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset selection whenever available options change.
  useEffect(() => {
    setSelectedIndex(0)
  }, [itemIds])

  const selectItem = (index: number) => {
    const option = items[index]
    if (!option) {
      return false
    }
    command(toTaskMentionAttributes(option))
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

  if (items.length === 0) {
    return null
  }

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
