import {
  and,
  type DatabaseClient,
  db,
  eq,
  isNotNull,
  isNull,
  ne,
  or,
} from "../../client"
import { automatedResponseModel, flowModel } from "../../schema"

export const automatedResponseRepository = {
  /**
   * Whether an enabled inbound (Contact) keyword rule would answer a message
   * on its own: its published, active flow, or — without a flow — a non-empty
   * text reply. Outbound (Page) rules never answer an inbound message.
   */
  async existsAnsweringInboundRule(
    input: { workspaceId: string },
    tx: DatabaseClient = db,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: automatedResponseModel.id })
      .from(automatedResponseModel)
      .leftJoin(
        flowModel,
        and(
          eq(flowModel.id, automatedResponseModel.flowId),
          eq(flowModel.workspaceId, input.workspaceId),
        ),
      )
      .where(
        and(
          eq(automatedResponseModel.workspaceId, input.workspaceId),
          eq(automatedResponseModel.type, "inbound"),
          eq(automatedResponseModel.status, true),
          or(
            and(
              isNotNull(automatedResponseModel.flowId),
              eq(flowModel.active, true),
              isNotNull(flowModel.currentVersionId),
            ),
            // `text <> ''` is NULL for a NULL text, so text-less rules drop out.
            and(
              isNull(automatedResponseModel.flowId),
              isNotNull(automatedResponseModel.text),
              ne(automatedResponseModel.text, ""),
            ),
          ),
        ),
      )
      .limit(1)
    return Boolean(row)
  },
}
