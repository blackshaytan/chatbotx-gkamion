"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@chatbotx.io/ui/components/ui/sheet"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { useTaskSearchParams } from "../hooks/use-task-search-params"
import { TaskDetails } from "./task-details"

type TaskSheetProps = {
  workspaceId: string
}

export const TaskSheet = ({ workspaceId }: TaskSheetProps) => {
  const t = useTranslations("tasks")
  const [{ task: taskId }, setSearchParams] = useTaskSearchParams()

  const handleOpenChange = async (open: boolean) => {
    if (open) {
      return
    }

    await setSearchParams({ task: null })
  }

  const handleDeleted = async () => {
    await setSearchParams({ task: null })
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={Boolean(taskId)}>
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-3xl"
        side="right"
      >
        {taskId ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("title")}</SheetTitle>
              <SheetDescription className="sr-only">
                {t("title")}
              </SheetDescription>
              <Button
                render={<Link href={`/space/${workspaceId}/tasks/${taskId}`} />}
                size="sm"
                variant="link"
              >
                {t("actions.openStandalone")}
              </Button>
            </SheetHeader>
            <div className="px-4 pb-6">
              <TaskDetails
                onDeleted={handleDeleted}
                taskId={taskId}
                workspaceId={workspaceId}
              />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
