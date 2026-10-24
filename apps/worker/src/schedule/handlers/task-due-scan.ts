import {
  notificationService,
  withBlockedOwnerGuard,
} from "@chatbotx.io/business"
import { distributedLock } from "@chatbotx.io/redis"
import { logger } from "../../lib/logger"

const BATCH_SIZE = 200
const MAX_BATCHES_PER_RUN = 10
const LOCK_TTL_SECONDS = 55

export async function taskDueScan(): Promise<void> {
  await distributedLock.runExclusive({
    key: "schedule:task-due-scan",
    timeoutInSeconds: LOCK_TTL_SECONDS,
    fn: async () => {
      const { reminders, overdue } =
        await notificationService.processDueTaskNotifications({
          now: new Date(),
          batchSize: BATCH_SIZE,
          maxBatches: MAX_BATCHES_PER_RUN,
          guard: withBlockedOwnerGuard,
        })
      if (reminders > 0 || overdue > 0) {
        logger.info(
          { reminders, overdue },
          "Task due scan processed notifications",
        )
      }
    },
  })
}
