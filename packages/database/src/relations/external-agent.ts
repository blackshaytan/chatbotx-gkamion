import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const externalAgentRelations = defineRelationsPart(schema, (r) => ({
  externalAgentModel: {
    workspace: r.one.workspaceModel({
      from: r.externalAgentModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    inboxes: r.many.externalAgentInboxModel({
      from: r.externalAgentModel.id,
      to: r.externalAgentInboxModel.externalAgentId,
    }),
  },
  externalAgentInboxModel: {
    externalAgent: r.one.externalAgentModel({
      from: r.externalAgentInboxModel.externalAgentId,
      to: r.externalAgentModel.id,
      optional: false,
    }),
    inbox: r.one.inboxModel({
      from: r.externalAgentInboxModel.inboxId,
      to: r.inboxModel.id,
      optional: false,
    }),
  },
}))
