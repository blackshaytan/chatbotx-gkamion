import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const taskRelations = defineRelationsPart(schema, (r) => ({
  taskModel: {
    workspace: r.one.workspaceModel({
      from: r.taskModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    thread: r.one.internalThreadModel({
      from: r.taskModel.threadId,
      to: r.internalThreadModel.id,
      optional: false,
    }),
    assigneeUser: r.one.userModel({
      from: r.taskModel.assigneeUserId,
      to: r.userModel.id,
    }),
    assigneeTeam: r.one.inboxTeamModel({
      from: r.taskModel.assigneeTeamId,
      to: r.inboxTeamModel.id,
    }),
    createdByUser: r.one.userModel({
      from: r.taskModel.createdByUserId,
      to: r.userModel.id,
    }),
    watchers: r.many.taskWatcherModel({
      from: r.taskModel.id,
      to: r.taskWatcherModel.taskId,
    }),
    targets: r.many.taskTargetModel({
      from: r.taskModel.id,
      to: r.taskTargetModel.taskId,
    }),
  },
  taskWatcherModel: {
    task: r.one.taskModel({
      from: r.taskWatcherModel.taskId,
      to: r.taskModel.id,
      optional: false,
    }),
    user: r.one.userModel({
      from: r.taskWatcherModel.userId,
      to: r.userModel.id,
      optional: false,
    }),
  },
  taskTargetModel: {
    task: r.one.taskModel({
      from: r.taskTargetModel.taskId,
      to: r.taskModel.id,
      optional: false,
    }),
    contact: r.one.contactModel({
      from: r.taskTargetModel.contactId,
      to: r.contactModel.id,
    }),
    conversation: r.one.conversationModel({
      from: r.taskTargetModel.conversationId,
      to: r.conversationModel.id,
    }),
  },
}))
