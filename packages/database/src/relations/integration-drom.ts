import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const integrationDromRelations = defineRelationsPart(schema, (r) => ({
  integrationDromModel: {
    workspace: r.one.workspaceModel({
      from: r.integrationDromModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    inbox: r.one.inboxModel({
      from: r.integrationDromModel.inboxId,
      to: r.inboxModel.id,
      optional: false,
    }),
  },
}))
