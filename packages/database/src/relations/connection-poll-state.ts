import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const connectionPollStateRelations = defineRelationsPart(
  schema,
  (r) => ({
    connectionPollStateModel: {
      connection: r.one.connectionModel({
        from: r.connectionPollStateModel.connectionId,
        to: r.connectionModel.id,
        optional: false,
      }),
    },
  }),
)
