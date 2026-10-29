import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const externalCrmRelations = defineRelationsPart(schema, (r) => ({
  externalCustomerIdentityModel: {
    workspace: r.one.workspaceModel({
      from: r.externalCustomerIdentityModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    contact: r.one.contactModel({
      from: r.externalCustomerIdentityModel.contactId,
      to: r.contactModel.id,
      optional: false,
    }),
  },
  externalOrderModel: {
    workspace: r.one.workspaceModel({
      from: r.externalOrderModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    contact: r.one.contactModel({
      from: r.externalOrderModel.contactId,
      to: r.contactModel.id,
      optional: false,
    }),
  },
  externalOrderEventModel: {
    workspace: r.one.workspaceModel({
      from: r.externalOrderEventModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
  },
}))
