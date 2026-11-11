import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const externalAgentDialogMemoryRelations = defineRelationsPart(
  schema,
  (r) => ({
    dialogMemorySourceModel: {
      workspace: r.one.workspaceModel({
        from: r.dialogMemorySourceModel.workspaceId,
        to: r.workspaceModel.id,
        optional: false,
      }),
      conversation: r.one.conversationModel({
        from: [
          r.dialogMemorySourceModel.workspaceId,
          r.dialogMemorySourceModel.conversationId,
        ],
        to: [r.conversationModel.workspaceId, r.conversationModel.id],
        optional: false,
      }),
    },
    dialogMemoryModel: {
      workspace: r.one.workspaceModel({
        from: r.dialogMemoryModel.workspaceId,
        to: r.workspaceModel.id,
        optional: false,
      }),
      conversation: r.one.conversationModel({
        from: [
          r.dialogMemoryModel.workspaceId,
          r.dialogMemoryModel.conversationId,
        ],
        to: [r.conversationModel.workspaceId, r.conversationModel.id],
        optional: false,
      }),
    },
  }),
)
