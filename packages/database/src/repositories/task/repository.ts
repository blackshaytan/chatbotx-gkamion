import {
  and,
  countWithRelationsFilter,
  type DatabaseClient,
  db,
  eq,
  inArray,
} from "../../client"
import {
  contactModel,
  conversationModel,
  inboxTeamModel,
  internalThreadModel,
  taskModel,
  taskTargetModel,
  taskWatcherModel,
  workspaceMemberModel,
  workspaceModel,
} from "../../schema"
import type { TaskModel, TaskTargetModel } from "../../types"
import {
  buildTaskListWhere,
  TASK_LIST_ORDER_BY,
  type TaskListFilter,
} from "./list-where"

export type TaskInsert = typeof taskModel.$inferInsert
export type TaskTargetInsert = typeof taskTargetModel.$inferInsert
export type TaskUpdate = Partial<
  Omit<TaskInsert, "id" | "workspaceId" | "threadId" | "createdAt">
>
export type TaskWithRelations = TaskModel & {
  watchers: { userId: string }[]
  targets: TaskTargetModel[]
}
export type TaskAssignmentRow = {
  id: string
  threadId: string
  assigneeUserId: string | null
  assigneeTeamId: string | null
}

const withRelations = {
  watchers: { columns: { userId: true }, orderBy: { id: "asc" } },
  targets: { orderBy: { id: "asc" } },
} as const

const assignmentColumns = {
  id: taskModel.id,
  threadId: taskModel.threadId,
  assigneeUserId: taskModel.assigneeUserId,
  assigneeTeamId: taskModel.assigneeTeamId,
}

class TaskRepository {
  async findWorkspace(props: {
    workspaceId: string
    tx?: DatabaseClient
  }): Promise<{ ownerId: string; timezone: string } | undefined> {
    const { workspaceId, tx = db } = props
    const [row] = await tx
      .select({
        ownerId: workspaceModel.ownerId,
        timezone: workspaceModel.timezone,
      })
      .from(workspaceModel)
      .where(eq(workspaceModel.id, workspaceId))
      .limit(1)
    return row
  }

  /** The ids among `userIds` that are real members of the workspace. */
  async listMemberUserIds(props: {
    workspaceId: string
    userIds: string[]
    tx?: DatabaseClient
  }): Promise<string[]> {
    const { workspaceId, userIds, tx = db } = props
    if (userIds.length === 0) {
      return []
    }
    const rows = await tx
      .select({ userId: workspaceMemberModel.userId })
      .from(workspaceMemberModel)
      .where(
        and(
          eq(workspaceMemberModel.workspaceId, workspaceId),
          inArray(workspaceMemberModel.userId, userIds),
        ),
      )
    return rows.map((row) => row.userId)
  }

  async listTeamIds(props: {
    workspaceId: string
    teamIds: string[]
    tx?: DatabaseClient
  }): Promise<string[]> {
    const { workspaceId, teamIds, tx = db } = props
    if (teamIds.length === 0) {
      return []
    }
    const rows = await tx
      .select({ id: inboxTeamModel.id })
      .from(inboxTeamModel)
      .where(
        and(
          eq(inboxTeamModel.workspaceId, workspaceId),
          inArray(inboxTeamModel.id, teamIds),
        ),
      )
    return rows.map((row) => row.id)
  }

  async findContact(props: {
    workspaceId: string
    contactId: string
    tx?: DatabaseClient
  }): Promise<{ id: string } | undefined> {
    const { workspaceId, contactId, tx = db } = props
    const [row] = await tx
      .select({ id: contactModel.id })
      .from(contactModel)
      .where(
        and(
          eq(contactModel.workspaceId, workspaceId),
          eq(contactModel.id, contactId),
        ),
      )
      .limit(1)
    return row
  }

  async findConversation(props: {
    workspaceId: string
    conversationId: string
    tx?: DatabaseClient
  }): Promise<{ id: string; contactId: string } | undefined> {
    const { workspaceId, conversationId, tx = db } = props
    const [row] = await tx
      .select({
        id: conversationModel.id,
        contactId: conversationModel.contactId,
      })
      .from(conversationModel)
      .where(
        and(
          eq(conversationModel.workspaceId, workspaceId),
          eq(conversationModel.id, conversationId),
        ),
      )
      .limit(1)
    return row
  }

  /**
   * Which of the given contacts and conversations a member restricted to
   * assigned contacts may see: those whose conversation is assigned to them.
   */
  async listVisibleTargetIds(props: {
    workspaceId: string
    assignedUserId: string
    contactIds: string[]
    conversationIds: string[]
    tx?: DatabaseClient
  }): Promise<{ contactIds: string[]; conversationIds: string[] }> {
    const {
      workspaceId,
      assignedUserId,
      contactIds,
      conversationIds,
      tx = db,
    } = props
    if (contactIds.length === 0 && conversationIds.length === 0) {
      return { contactIds: [], conversationIds: [] }
    }
    const scope = and(
      eq(conversationModel.workspaceId, workspaceId),
      eq(conversationModel.assignedUserId, assignedUserId),
    )
    const [contacts, conversations] = await Promise.all([
      contactIds.length === 0
        ? []
        : tx
            .select({ id: conversationModel.contactId })
            .from(conversationModel)
            .where(
              and(scope, inArray(conversationModel.contactId, contactIds)),
            ),
      conversationIds.length === 0
        ? []
        : tx
            .select({ id: conversationModel.id })
            .from(conversationModel)
            .where(and(scope, inArray(conversationModel.id, conversationIds))),
    ])
    return {
      contactIds: contacts.map((row) => row.id),
      conversationIds: conversations.map((row) => row.id),
    }
  }

  async insertTask(props: {
    values: TaskInsert
    tx?: DatabaseClient
  }): Promise<TaskModel> {
    const { values, tx = db } = props
    const [task] = await tx.insert(taskModel).values(values).returning()
    return task
  }

  async insertWatchers(props: {
    rows: { taskId: string; userId: string }[]
    tx?: DatabaseClient
  }): Promise<void> {
    const { rows, tx = db } = props
    if (rows.length === 0) {
      return
    }
    await tx.insert(taskWatcherModel).values(rows).onConflictDoNothing()
  }

  async deleteWatcher(props: {
    taskId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { taskId, userId, tx = db } = props
    await tx
      .delete(taskWatcherModel)
      .where(
        and(
          eq(taskWatcherModel.taskId, taskId),
          eq(taskWatcherModel.userId, userId),
        ),
      )
  }

  async insertTargets(props: {
    rows: TaskTargetInsert[]
    tx?: DatabaseClient
  }): Promise<void> {
    const { rows, tx = db } = props
    if (rows.length === 0) {
      return
    }
    await tx.insert(taskTargetModel).values(rows)
  }

  async findById(props: {
    workspaceId: string
    id: string
    tx?: DatabaseClient
  }): Promise<TaskWithRelations | undefined> {
    const { workspaceId, id, tx = db } = props
    return await tx.query.taskModel.findFirst({
      where: { workspaceId, id },
      with: withRelations,
    })
  }

  async list(props: {
    filter: TaskListFilter
    limit: number
    offset: number
    tx?: DatabaseClient
  }): Promise<{ rows: TaskWithRelations[]; total: number }> {
    const { filter, limit, offset, tx = db } = props
    const where = buildTaskListWhere(filter)
    const [rows, total] = await Promise.all([
      tx.query.taskModel.findMany({
        where,
        orderBy: TASK_LIST_ORDER_BY,
        limit,
        offset,
        with: withRelations,
      }),
      countWithRelationsFilter({
        client: tx,
        table: taskModel,
        tsName: "taskModel",
        where,
      }),
    ])
    return { rows, total }
  }

  async update(props: {
    workspaceId: string
    id: string
    set: TaskUpdate
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, id, set, tx = db } = props
    await tx
      .update(taskModel)
      .set(set)
      .where(and(eq(taskModel.workspaceId, workspaceId), eq(taskModel.id, id)))
  }

  /** Deleting the thread cascades its messages and members. */
  async deleteWithThread(props: {
    workspaceId: string
    id: string
    threadId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, id, threadId, tx = db } = props
    await tx
      .delete(taskModel)
      .where(and(eq(taskModel.workspaceId, workspaceId), eq(taskModel.id, id)))
    await tx
      .delete(internalThreadModel)
      .where(
        and(
          eq(internalThreadModel.workspaceId, workspaceId),
          eq(internalThreadModel.id, threadId),
        ),
      )
  }

  async listAssignedToUser(props: {
    workspaceId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<TaskAssignmentRow[]> {
    const { workspaceId, userId, tx = db } = props
    return await tx
      .select(assignmentColumns)
      .from(taskModel)
      .where(
        and(
          eq(taskModel.workspaceId, workspaceId),
          eq(taskModel.assigneeUserId, userId),
        ),
      )
  }

  async listAssignedToTeams(props: {
    workspaceId: string
    teamIds: string[]
    tx?: DatabaseClient
  }): Promise<TaskAssignmentRow[]> {
    const { workspaceId, teamIds, tx = db } = props
    if (teamIds.length === 0) {
      return []
    }
    return await tx
      .select(assignmentColumns)
      .from(taskModel)
      .where(
        and(
          eq(taskModel.workspaceId, workspaceId),
          inArray(taskModel.assigneeTeamId, teamIds),
        ),
      )
  }

  async assignToUser(props: {
    workspaceId: string
    taskIds: string[]
    userId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, taskIds, userId, tx = db } = props
    if (taskIds.length === 0) {
      return
    }
    await tx
      .update(taskModel)
      .set({ assigneeUserId: userId, assigneeTeamId: null })
      .where(
        and(
          eq(taskModel.workspaceId, workspaceId),
          inArray(taskModel.id, taskIds),
        ),
      )
  }
}

export const taskRepository = new TaskRepository()
