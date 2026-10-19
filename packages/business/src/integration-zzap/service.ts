import { db } from "@chatbotx.io/database/client"
import {
  connectionPollStateRepository,
  connectionRepository,
} from "@chatbotx.io/database/repositories"
import type {
  ConnectionModel,
  ConnectionPollStateModel,
  IntegrationZzapModel,
} from "@chatbotx.io/database/types"

export type ZzapChannelRow = Omit<IntegrationZzapModel, "auth"> & {
  connection: Pick<
    ConnectionModel,
    "id" | "status" | "statusReason" | "lastError"
  > | null
  lastPolledAt: ConnectionPollStateModel["lastPolledAt"] | null
  lastSucceededAt: ConnectionPollStateModel["lastSucceededAt"] | null
}

export const zzapIntegrationService = {
  /** Settings list: never returns auth, adds the connection and poll state. */
  async listByWorkspace(workspaceId: string): Promise<ZzapChannelRow[]> {
    const rows = await db.query.integrationZzapModel.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    })
    return await Promise.all(
      rows.map(async ({ auth: _auth, ...row }) => {
        const connection = await connectionRepository.findByInboxId({
          inboxId: row.inboxId,
        })
        const state = connection
          ? await connectionPollStateRepository.find(connection.id)
          : undefined
        return {
          ...row,
          connection: connection
            ? {
                id: connection.id,
                status: connection.status,
                statusReason: connection.statusReason,
                lastError: connection.lastError,
              }
            : null,
          lastPolledAt: state?.lastPolledAt ?? null,
          lastSucceededAt: state?.lastSucceededAt ?? null,
        }
      }),
    )
  },
}
