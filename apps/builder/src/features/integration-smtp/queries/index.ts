"use server"

import { integrationSmtpService } from "@chatbotx.io/business"
import { assertCurrentUserCanAccessChatbot } from "@/lib/auth/utils"
import type { IntegrationSmtpEditable } from "../schema/resource"

export const listIntegrationSmtps = async (input: {
  workspaceId: string
}): Promise<{ data: IntegrationSmtpEditable[] }> => {
  await assertCurrentUserCanAccessChatbot(input.workspaceId)

  const data = await integrationSmtpService.listByWorkspace(input.workspaceId)

  return { data }
}
