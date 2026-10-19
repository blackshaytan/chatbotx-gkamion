import { db } from "@chatbotx.io/database/client"
import { connectionRepository } from "@chatbotx.io/database/repositories"
import type {
  ConnectionModel,
  IntegrationMaxModel,
} from "@chatbotx.io/database/types"
import type { AuthValue } from "@chatbotx.io/sdk"
import { openAuth } from "../connection/sealed-auth"

export type MaxChannelRow = Omit<IntegrationMaxModel, "auth"> & {
  connection: Pick<ConnectionModel, "id" | "status" | "statusReason"> | null
}

export const maxIntegrationService = {
  /** Webhook-only lookup by bot id; returns the opened auth for secret checks. */
  async findByBotIdWithAuth(
    botId: string,
  ): Promise<{ row: IntegrationMaxModel; auth: AuthValue } | null> {
    const row = await db.query.integrationMaxModel.findFirst({
      where: { botId },
    })
    if (!row) {
      return null
    }
    return { row, auth: await openAuth(row.auth) }
  },

  /** Settings list: never returns auth, adds the connection state for the on/off switch. */
  async listByWorkspace(workspaceId: string): Promise<MaxChannelRow[]> {
    const rows = await db.query.integrationMaxModel.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    })
    return await Promise.all(
      rows.map(async ({ auth: _auth, ...row }) => {
        const connection = await connectionRepository.findByInboxId({
          inboxId: row.inboxId,
        })
        return {
          ...row,
          connection: connection
            ? {
                id: connection.id,
                status: connection.status,
                statusReason: connection.statusReason,
              }
            : null,
        }
      }),
    )
  },
}
