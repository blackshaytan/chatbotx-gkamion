import {
  and,
  type DatabaseClient,
  db,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "../../client"
import type { IntegrationType } from "../../partials/integration"
import { connectionModel, connectionPollStateModel } from "../../schema"
import type { ConnectionPollStateModel } from "../../types"

export type ConnectionPollStateUpsert = {
  connectionId: string
  workspaceId: string
  intervalSeconds?: number
  cursor?: Record<string, unknown> | null
  lastPolledAt?: Date
  lastSucceededAt?: Date
}

const FALLBACK_INTERVAL_SECONDS = 60

export const connectionPollStateRepository = {
  async find(
    connectionId: string,
    tx: DatabaseClient = db,
  ): Promise<ConnectionPollStateModel | undefined> {
    return await tx.query.connectionPollStateModel.findFirst({
      where: { connectionId },
    })
  },

  async upsert(
    values: ConnectionPollStateUpsert,
    tx: DatabaseClient = db,
  ): Promise<void> {
    const { connectionId, workspaceId, ...rest } = values
    await tx
      .insert(connectionPollStateModel)
      .values({
        connectionId,
        workspaceId,
        ...rest,
        intervalSeconds: rest.intervalSeconds ?? FALLBACK_INTERVAL_SECONDS,
      })
      .onConflictDoUpdate({
        target: connectionPollStateModel.connectionId,
        set: rest,
      })
  },

  /** `connected` connections of the given providers whose next poll is due. */
  async listDue(
    input: {
      providers: IntegrationType[]
      now: Date
      defaultIntervalSeconds: number
    },
    tx: DatabaseClient = db,
  ): Promise<{ connectionId: string; workspaceId: string }[]> {
    if (input.providers.length === 0) {
      return []
    }
    const interval = sql`coalesce(${connectionPollStateModel.intervalSeconds}, ${input.defaultIntervalSeconds})`
    return await tx
      .select({
        connectionId: connectionModel.id,
        workspaceId: connectionModel.workspaceId,
      })
      .from(connectionModel)
      .leftJoin(
        connectionPollStateModel,
        eq(connectionPollStateModel.connectionId, connectionModel.id),
      )
      .where(
        and(
          inArray(connectionModel.provider, input.providers),
          eq(connectionModel.status, "connected"),
          or(
            isNull(connectionPollStateModel.lastPolledAt),
            lte(
              sql`${connectionPollStateModel.lastPolledAt} + make_interval(secs => ${interval})`,
              input.now,
            ),
          ),
        ),
      )
  },
}
