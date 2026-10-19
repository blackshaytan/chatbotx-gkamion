import { zzapIntegrationService } from "@chatbotx.io/business"

export const listZzapChannels = async ({
  workspaceId,
}: {
  workspaceId: string
}) => ({ data: await zzapIntegrationService.listByWorkspace(workspaceId) })
