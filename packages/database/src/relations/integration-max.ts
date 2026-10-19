import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const integrationMaxRelations = defineRelationsPart(schema, (r) => ({
  integrationMaxModel: {
    workspace: r.one.workspaceModel({
      from: r.integrationMaxModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    inbox: r.one.inboxModel({
      from: r.integrationMaxModel.inboxId,
      to: r.inboxModel.id,
      optional: false,
    }),
  },
}))
