"use client"

import { useTranslations } from "next-intl"
import {
  useInboxTeams,
  useWorkspaceMembers,
} from "@/features/users/provider/user-hook"
import { useWorkspaceId } from "@/hooks/routing"

type TaskAssigneeLabelProps = {
  assigneeUserId: string | null
  assigneeTeamId: string | null
}

export const TaskAssigneeLabel = ({
  assigneeUserId,
  assigneeTeamId,
}: TaskAssigneeLabelProps) => {
  const t = useTranslations("tasks")
  const workspaceId = useWorkspaceId()
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId)
  const { data: inboxTeams = [] } = useInboxTeams(workspaceId)

  if (assigneeUserId) {
    const member = workspaceMembers.find(
      (workspaceMember) => workspaceMember.userId === assigneeUserId,
    )

    return <span>{member?.user?.name ?? t("hidden")}</span>
  }

  if (assigneeTeamId) {
    const team = inboxTeams.find((inboxTeam) => inboxTeam.id === assigneeTeamId)

    return <span>{team?.name ?? t("hidden")}</span>
  }

  return <span className="text-muted-foreground">{t("hidden")}</span>
}
