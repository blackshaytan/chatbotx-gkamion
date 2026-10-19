import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const integrationZzapRelations = defineRelationsPart(schema, (r) => ({
  integrationZzapModel: {
    workspace: r.one.workspaceModel({
      from: r.integrationZzapModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    inbox: r.one.inboxModel({
      from: r.integrationZzapModel.inboxId,
      to: r.inboxModel.id,
      optional: false,
    }),
  },
}))
