import { runPoll } from "@chatbotx.io/connections"
import {
  IntegrationJobAction,
  integrationQueue,
  type LowJobPollChannel,
} from "@chatbotx.io/worker-config"
import { logger } from "../../lib/logger"

export const pollChannel = async (
  data: LowJobPollChannel["data"],
): Promise<void> => {
  const result = await runPoll({
    ...data,
    enqueue: async (job) => {
      await integrationQueue.add(IntegrationJobAction.incomingMessage, {
        type: IntegrationJobAction.incomingMessage,
        data: job,
      })
    },
  })
  if (result.status === "ok" && result.events > 0) {
    logger.info(
      { ...data, events: result.events },
      "channel poll enqueued events",
    )
  }
}
