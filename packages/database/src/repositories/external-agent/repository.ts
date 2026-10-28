import type { z } from "zod"
import {
  and,
  type DatabaseClient,
  db,
  eq,
  inArray,
  notInArray,
} from "../../client"
import type { externalAgentCheckStatuses } from "../../partials/external-agent"
import {
  contactInboxModel,
  conversationModel,
  externalAgentConversationStateModel,
  externalAgentInboxModel,
  externalAgentModel,
} from "../../schema"
import type {
  ExternalAgentConversationStateModel,
  ExternalAgentModel,
} from "../../types"

export type ExternalAgentUpsertValues = Omit<
  typeof externalAgentModel.$inferInsert,
  "id" | "workspaceId" | "purpose" | "createdAt" | "updatedAt"
>

export type ExternalAgentResumePolicy = {
  conversationId: string
  resumeAfterHours: number | null
}

export type ExternalAgentConversationStatePatch = Partial<
  Omit<
    typeof externalAgentConversationStateModel.$inferInsert,
    "conversationId" | "workspaceId" | "updatedAt"
  >
>

/** Replaces the inbox links of one agent: drops the links not listed, adds the missing ones. */
const replaceInboxLinks = async (
  input: { externalAgentId: string; workspaceId: string; inboxIds: string[] },
  tx: DatabaseClient,
): Promise<void> => {
  const { externalAgentId, workspaceId, inboxIds } = input
  await tx
    .delete(externalAgentInboxModel)
    .where(
      and(
        eq(externalAgentInboxModel.externalAgentId, externalAgentId),
        eq(externalAgentInboxModel.workspaceId, workspaceId),
        inboxIds.length > 0
          ? notInArray(externalAgentInboxModel.inboxId, inboxIds)
          : undefined,
      ),
    )
  if (inboxIds.length === 0) {
    return
  }
  await tx
    .insert(externalAgentInboxModel)
    .values(
      inboxIds.map((inboxId) => ({
        externalAgentId,
        inboxId,
        workspaceId,
      })),
    )
    .onConflictDoNothing({
      target: [
        externalAgentInboxModel.externalAgentId,
        externalAgentInboxModel.inboxId,
      ],
    })
}

export const externalAgentRepository = {
  async findByWorkspace(
    workspaceId: string,
    purpose: "client" | "staff",
    tx: DatabaseClient = db,
  ): Promise<(ExternalAgentModel & { inboxIds: string[] }) | null> {
    const row = await tx.query.externalAgentModel.findFirst({
      where: { workspaceId, purpose },
      with: { inboxes: { columns: { inboxId: true } } },
    })
    if (!row) {
      return null
    }
    const { inboxes, ...agent } = row
    return {
      ...agent,
      inboxIds: inboxes.map((link) => link.inboxId),
    }
  },

  async findActiveForInbox(
    input: { workspaceId: string; inboxId: string },
    tx: DatabaseClient = db,
  ): Promise<ExternalAgentModel | null> {
    const [row] = await tx
      .select({ agent: externalAgentModel })
      .from(externalAgentModel)
      .innerJoin(
        externalAgentInboxModel,
        eq(externalAgentInboxModel.externalAgentId, externalAgentModel.id),
      )
      .where(
        and(
          eq(externalAgentModel.workspaceId, input.workspaceId),
          eq(externalAgentModel.purpose, "client"),
          eq(externalAgentModel.enabled, true),
          eq(externalAgentInboxModel.workspaceId, input.workspaceId),
          eq(externalAgentInboxModel.inboxId, input.inboxId),
        ),
      )
      .limit(1)
    return row?.agent ?? null
  },

  /**
   * Conversations (of the given ids) whose contact is reachable through an
   * inbox where the workspace's enabled external agent answers.
   */
  async findResumePolicyForConversations(
    input: { workspaceId: string; conversationIds: string[] },
    tx: DatabaseClient = db,
  ): Promise<ExternalAgentResumePolicy[]> {
    const { workspaceId, conversationIds } = input
    if (conversationIds.length === 0) {
      return []
    }
    return await tx
      .selectDistinct({
        conversationId: conversationModel.id,
        resumeAfterHours: externalAgentModel.resumeAfterHours,
      })
      .from(conversationModel)
      .innerJoin(
        contactInboxModel,
        eq(contactInboxModel.contactId, conversationModel.contactId),
      )
      .innerJoin(
        externalAgentInboxModel,
        and(
          eq(externalAgentInboxModel.inboxId, contactInboxModel.inboxId),
          eq(externalAgentInboxModel.workspaceId, workspaceId),
        ),
      )
      .innerJoin(
        externalAgentModel,
        and(
          eq(externalAgentModel.id, externalAgentInboxModel.externalAgentId),
          eq(externalAgentModel.workspaceId, workspaceId),
          eq(externalAgentModel.purpose, "client"),
          eq(externalAgentModel.enabled, true),
        ),
      )
      .where(
        and(
          eq(conversationModel.workspaceId, workspaceId),
          inArray(conversationModel.id, conversationIds),
        ),
      )
  },

  async updateCheck(
    input: {
      workspaceId: string
      purpose: "client" | "staff"
      status: z.infer<typeof externalAgentCheckStatuses>
      error: string | null
      checkedAt: Date
    },
    tx: DatabaseClient = db,
  ): Promise<void> {
    await tx
      .update(externalAgentModel)
      .set({
        lastCheckStatus: input.status,
        lastCheckError: input.error,
        lastCheckedAt: input.checkedAt,
      })
      .where(
        and(
          eq(externalAgentModel.workspaceId, input.workspaceId),
          eq(externalAgentModel.purpose, input.purpose),
        ),
      )
  },

  /**
   * Creates or updates the workspace agent. `inboxIds` is optional: `undefined`
   * keeps the current inbox links. Must run inside the caller's transaction.
   */
  async upsert(
    input: {
      workspaceId: string
      purpose: "client" | "staff"
      values: ExternalAgentUpsertValues
      inboxIds?: string[]
    },
    tx: DatabaseClient,
  ): Promise<ExternalAgentModel> {
    const { workspaceId, purpose, values, inboxIds } = input
    const [agent] = await tx
      .insert(externalAgentModel)
      .values({
        ...values,
        workspaceId,
        purpose,
        signMessages: values.signMessages ?? false,
        announceManager: values.announceManager ?? false,
      })
      .onConflictDoUpdate({
        target: [externalAgentModel.workspaceId, externalAgentModel.purpose],
        set: { ...values, updatedAt: new Date() },
      })
      .returning()
    if (!agent) {
      throw new Error("External agent upsert returned no row")
    }
    if (inboxIds !== undefined) {
      await replaceInboxLinks(
        {
          externalAgentId: agent.id,
          workspaceId,
          inboxIds: [...new Set(inboxIds)],
        },
        tx,
      )
    }
    return agent
  },
}

export const externalAgentStateRepository = {
  async find(
    input: { workspaceId: string; conversationId: string },
    tx: DatabaseClient = db,
  ): Promise<ExternalAgentConversationStateModel | undefined> {
    const [row] = await tx
      .select()
      .from(externalAgentConversationStateModel)
      .where(
        and(
          eq(
            externalAgentConversationStateModel.conversationId,
            input.conversationId,
          ),
          eq(
            externalAgentConversationStateModel.workspaceId,
            input.workspaceId,
          ),
        ),
      )
      .limit(1)
    return row
  },

  async upsert(
    values: typeof externalAgentConversationStateModel.$inferInsert,
    tx: DatabaseClient = db,
  ): Promise<void> {
    await tx
      .insert(externalAgentConversationStateModel)
      .values(values)
      .onConflictDoUpdate({
        target: externalAgentConversationStateModel.conversationId,
        set: { ...values, updatedAt: new Date() },
      })
  },

  /** Returns the number of updated rows; `expectedRunId` guards against overwriting a newer run. */
  async patch(
    input: {
      workspaceId: string
      conversationId: string
      values: ExternalAgentConversationStatePatch
      expectedRunId?: string
    },
    tx: DatabaseClient = db,
  ): Promise<number> {
    const { workspaceId, conversationId, values, expectedRunId } = input
    const rows = await tx
      .update(externalAgentConversationStateModel)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(
            externalAgentConversationStateModel.conversationId,
            conversationId,
          ),
          eq(externalAgentConversationStateModel.workspaceId, workspaceId),
          expectedRunId === undefined
            ? undefined
            : eq(externalAgentConversationStateModel.runId, expectedRunId),
        ),
      )
      .returning({
        conversationId: externalAgentConversationStateModel.conversationId,
      })
    return rows.length
  },

  /** Rewinds the cursor of each conversation so the next run re-sends its history. */
  async resetForResume(
    input: { workspaceId: string; conversationIds: string[]; at: Date },
    tx: DatabaseClient = db,
  ): Promise<void> {
    const conversationIds = [...new Set(input.conversationIds)]
    if (conversationIds.length === 0) {
      return
    }
    const now = new Date()
    const resetValues = {
      cursorAt: input.at,
      cursorMessageId: null,
      includeHistory: true,
      runId: null,
      runStartedAt: null,
      failureCount: 0,
      lastError: null,
      progressFallbackSentAt: null,
      updatedAt: now,
    }
    await tx
      .insert(externalAgentConversationStateModel)
      .values(
        conversationIds.map((conversationId) => ({
          conversationId,
          workspaceId: input.workspaceId,
          ...resetValues,
        })),
      )
      .onConflictDoUpdate({
        target: externalAgentConversationStateModel.conversationId,
        set: resetValues,
      })
  },
}
