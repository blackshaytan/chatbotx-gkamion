import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const internalThreadRelations = defineRelationsPart(schema, (r) => ({
  internalThreadModel: {
    workspace: r.one.workspaceModel({
      from: r.internalThreadModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    members: r.many.internalThreadMemberModel({
      from: r.internalThreadModel.id,
      to: r.internalThreadMemberModel.threadId,
    }),
    messages: r.many.internalMessageModel({
      from: r.internalThreadModel.id,
      to: r.internalMessageModel.threadId,
    }),
  },
  internalThreadMemberModel: {
    thread: r.one.internalThreadModel({
      from: r.internalThreadMemberModel.threadId,
      to: r.internalThreadModel.id,
      optional: false,
    }),
    user: r.one.userModel({
      from: r.internalThreadMemberModel.userId,
      to: r.userModel.id,
      optional: false,
    }),
  },
  internalMessageModel: {
    thread: r.one.internalThreadModel({
      from: r.internalMessageModel.threadId,
      to: r.internalThreadModel.id,
      optional: false,
    }),
    authorUser: r.one.userModel({
      from: r.internalMessageModel.authorUserId,
      to: r.userModel.id,
    }),
  },
}))
