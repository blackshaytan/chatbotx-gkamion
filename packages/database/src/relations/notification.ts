import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const notificationRelations = defineRelationsPart(schema, (r) => ({
  notificationModel: {
    workspace: r.one.workspaceModel({
      from: r.notificationModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    user: r.one.userModel({
      from: r.notificationModel.userId,
      to: r.userModel.id,
      optional: false,
    }),
  },
}))
