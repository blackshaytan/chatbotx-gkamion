import { and, type DatabaseClient, db, eq } from "../../client"
import { externalAgentChatStateModel, internalThreadModel } from "../../schema"
import type { ExternalAgentChatStateModel } from "../../types"

export type ExternalAgentChatStatePatch = Partial<
  Omit<
    typeof externalAgentChatStateModel.$inferInsert,
    "threadId" | "workspaceId" | "updatedAt"
  >
>

export const externalAgentChatStateRepository = {
  async findForUpdate(
    input: { workspaceId: string; threadId: string },
    tx: DatabaseClient,
  ): Promise<ExternalAgentChatStateModel | undefined> {
    const [row] = await tx
      .select()
      .from(externalAgentChatStateModel)
      .where(
        and(
          eq(externalAgentChatStateModel.threadId, input.threadId),
          eq(externalAgentChatStateModel.workspaceId, input.workspaceId),
        ),
      )
      .for("update")
    return row
  },

  async find(
    input: { workspaceId: string; threadId: string },
    tx: DatabaseClient = db,
  ): Promise<ExternalAgentChatStateModel | undefined> {
    const [row] = await tx
      .select()
      .from(externalAgentChatStateModel)
      .where(
        and(
          eq(externalAgentChatStateModel.threadId, input.threadId),
          eq(externalAgentChatStateModel.workspaceId, input.workspaceId),
        ),
      )
      .limit(1)
    return row
  },

  async upsert(
    values: typeof externalAgentChatStateModel.$inferInsert & {
      includeHistory: boolean
      lastEventSeq: number
      failureCount: number
      updatedAt: Date
    },
    tx?: DatabaseClient,
  ): Promise<void> {
    if (!tx) {
      return await db.transaction((transaction) =>
        externalAgentChatStateRepository.upsert(values, transaction),
      )
    }
    const [thread] = await tx
      .select({ id: internalThreadModel.id })
      .from(internalThreadModel)
      .where(
        and(
          eq(internalThreadModel.id, values.threadId),
          eq(internalThreadModel.workspaceId, values.workspaceId),
        ),
      )
      .for("update")
    if (!thread) {
      throw new Error("Staff assistant thread does not belong to workspace")
    }
    const rows = await tx
      .insert(externalAgentChatStateModel)
      .values(values)
      .onConflictDoUpdate({
        target: externalAgentChatStateModel.threadId,
        set: { ...values, updatedAt: new Date() },
        setWhere: eq(
          externalAgentChatStateModel.workspaceId,
          values.workspaceId,
        ),
      })
      .returning({ threadId: externalAgentChatStateModel.threadId })
    if (rows.length === 0) {
      throw new Error("Staff assistant state belongs to a different workspace")
    }
  },

  async patch(
    input: {
      workspaceId: string
      threadId: string
      values: ExternalAgentChatStatePatch
      expectedRunId?: string
    },
    tx: DatabaseClient = db,
  ): Promise<number> {
    const rows = await tx
      .update(externalAgentChatStateModel)
      .set({ ...input.values, updatedAt: new Date() })
      .where(
        and(
          eq(externalAgentChatStateModel.threadId, input.threadId),
          eq(externalAgentChatStateModel.workspaceId, input.workspaceId),
          input.expectedRunId === undefined
            ? undefined
            : eq(externalAgentChatStateModel.runId, input.expectedRunId),
        ),
      )
      .returning({ threadId: externalAgentChatStateModel.threadId })
    return rows.length
  },
}
