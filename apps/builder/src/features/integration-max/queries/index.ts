import { maxIntegrationService } from "@chatbotx.io/business"

export const listMaxChannels = async ({
  workspaceId,
}: {
  workspaceId: string
}) => ({ data: await maxIntegrationService.listByWorkspace(workspaceId) })
