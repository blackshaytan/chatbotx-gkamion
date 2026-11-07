import {
  contactService,
  isOrderNotificationField,
  orderConditionGroupMatches,
} from "@chatbotx.io/business"
import { webhookChannelOrigin } from "@chatbotx.io/events/context"
import {
  type ConditionStepSchema,
  ORDER_NOTIFICATION_PAYLOAD_TYPE,
} from "@chatbotx.io/flow-config"
import { resolveContactVariablesDeep } from "@chatbotx.io/variables"
import {
  IntegrationJobAction,
  integrationQueue,
} from "@chatbotx.io/worker-config"
import { logger } from "../../lib/logger"
import { type ExecuteStepProps, seekConnectedNode } from "./flow-utils"

export async function handleCondition(
  props: ExecuteStepProps<ConditionStepSchema>,
): Promise<void> {
  const {
    conversation,
    contactInbox,
    flowVersion,
    step,
    useLatestFlowVersion,
    sendFrom,
    nodeVisits,
    metadata,
    trackingContext,
    commentAnchor,
    appointmentId,
  } = props

  const resolveMatchedHandleId = async (): Promise<string> => {
    try {
      const resolvedCases = await resolveContactVariablesDeep(
        conversation.contactId,
        step.cases,
        {
          contactInbox,
          conversation,
          ...(appointmentId ? { appointmentId } : {}),
        },
      )

      const orderPackage =
        metadata?.type === ORDER_NOTIFICATION_PAYLOAD_TYPE
          ? metadata.package
          : {}

      for (const conditionCase of resolvedCases) {
        if (conditionCase.conditions.length === 0) {
          continue
        }

        const orderConditions = conditionCase.conditions.filter((condition) =>
          isOrderNotificationField(condition.field),
        )
        const contactConditions = conditionCase.conditions.filter(
          (condition) => !isOrderNotificationField(condition.field),
        )
        const orderMatched =
          orderConditions.length === 0
            ? conditionCase.operator === "and"
            : orderConditionGroupMatches(
                {
                  operator: conditionCase.operator,
                  conditions: orderConditions,
                },
                orderPackage,
              )
        if (conditionCase.operator === "and" && !orderMatched) {
          continue
        }
        if (contactConditions.length === 0) {
          if (orderMatched) {
            return conditionCase.id
          }
          continue
        }

        const contactMatched = await contactService.matchesContactFilter({
          workspaceId: conversation.workspaceId,
          contactId: conversation.contactId,
          contactFilter: {
            operator: conditionCase.operator,
            conditions: contactConditions,
            // Timezone captured in the editor's browser at save time; the worker
            // has no browser context, so naive date values are interpreted here.
            timezone: conditionCase.timezone,
          },
        })
        const isMatched =
          conditionCase.operator === "or"
            ? orderMatched || contactMatched
            : orderMatched && contactMatched
        if (isMatched) {
          return conditionCase.id
        }
      }
    } catch (error) {
      logger.error(
        { err: error, conversationId: conversation.id, stepId: step.id },
        "[handleCondition] filter evaluation failed; routing to otherwise",
      )
    }

    return step.otherwiseId
  }

  const matchedHandleId = await resolveMatchedHandleId()
  const connectedNodeId = seekConnectedNode(flowVersion, matchedHandleId)
  if (!connectedNodeId) {
    return
  }

  await integrationQueue.add(IntegrationJobAction.sendFlow, {
    type: IntegrationJobAction.sendFlow,
    data: {
      conversationId: conversation.id,
      contactInboxId: contactInbox.id,
      flowId: flowVersion.flowId,
      flowVersionId: useLatestFlowVersion ? undefined : flowVersion.id,
      nodeId: connectedNodeId,
      metadata,
      appointmentId,
      trackingContext,
      sendFrom,
      nodeVisits,
      commentAnchor,
      origin: webhookChannelOrigin(),
    },
  })
}
