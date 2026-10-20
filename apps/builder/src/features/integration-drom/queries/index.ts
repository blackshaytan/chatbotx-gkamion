import { dromIntegrationService } from "@chatbotx.io/business"

export const listDromChannels = async ({
  workspaceId,
}: {
  workspaceId: string
}) => ({ data: await dromIntegrationService.listByWorkspace(workspaceId) })
