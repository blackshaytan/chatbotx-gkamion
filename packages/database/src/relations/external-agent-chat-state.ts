import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const externalAgentChatStateRelations = defineRelationsPart(
  schema,
  (r) => ({
    externalAgentChatStateModel: {
      thread: r.one.internalThreadModel({
        from: r.externalAgentChatStateModel.threadId,
        to: r.internalThreadModel.id,
        optional: false,
      }),
      workspace: r.one.workspaceModel({
        from: r.externalAgentChatStateModel.workspaceId,
        to: r.workspaceModel.id,
        optional: false,
      }),
    },
  }),
)
