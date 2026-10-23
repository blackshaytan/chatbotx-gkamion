import {
  notificationService,
  withBlockedOwnerGuard,
} from "@chatbotx.io/business"
import { taskRepository } from "@chatbotx.io/database/repositories"
import { distributedLock } from "@chatbotx.io/redis"
import { logger } from "../../lib/logger"

const BATCH_SIZE = 200
const MAX_BATCHES_PER_RUN = 10
const LOCK_TTL_SECONDS = 55

const processReminderBatches = async (now: Date): Promise<number> => {
  let processed = 0
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const claimed = await taskRepository.claimDueReminders({
      now,
      limit: BATCH_SIZE,
    })
    if (claimed.length === 0) {
      break
    }
    for (const task of claimed) {
      await withBlockedOwnerGuard(task.workspaceId, async () => {
        try {
          await notificationService.notifyTaskReminder(task)
        } catch (err) {
          logger.error({ err, taskId: task.id }, "Failed to send task reminder")
        }
      })
      processed += 1
    }
    if (claimed.length < BATCH_SIZE) {
      break
    }
  }
  return processed
}

const processOverdueBatches = async (now: Date): Promise<number> => {
  let processed = 0
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const claimed = await taskRepository.claimOverdue({
      now,
      limit: BATCH_SIZE,
    })
    if (claimed.length === 0) {
      break
    }
    for (const task of claimed) {
      await withBlockedOwnerGuard(task.workspaceId, async () => {
        try {
          await notificationService.notifyTaskOverdue(task)
        } catch (err) {
          logger.error(
            { err, taskId: task.id },
            "Failed to send task overdue notice",
          )
        }
      })
      processed += 1
    }
    if (claimed.length < BATCH_SIZE) {
      break
    }
  }
  return processed
}

export async function taskDueScan(): Promise<void> {
  await distributedLock.runExclusive({
    key: "schedule:task-due-scan",
    timeoutInSeconds: LOCK_TTL_SECONDS,
    fn: async () => {
      const now = new Date()
      const reminders = await processReminderBatches(now)
      const overdue = await processOverdueBatches(now)
      if (reminders > 0 || overdue > 0) {
        logger.info(
          { reminders, overdue },
          "Task due scan processed notifications",
        )
      }
    },
  })
}
