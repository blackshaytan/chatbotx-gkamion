import {
  notificationService,
  purgeOrderNotificationLogs,
} from "@chatbotx.io/business"
import { subDays } from "date-fns"
import { logger } from "../../lib/logger"

const RETENTION_DAYS = 90
const BATCH_SIZE = 5000

export async function purgeOldNotifications(): Promise<void> {
  const before = subDays(new Date(), RETENTION_DAYS)
  let deleted = 0

  for (;;) {
    const batchDeleted = await notificationService.purgeOlderThan({
      before,
      limit: BATCH_SIZE,
    })
    deleted += batchDeleted
    if (batchDeleted < BATCH_SIZE) {
      break
    }
  }

  if (deleted > 0) {
    logger.info(
      { deleted, retentionDays: RETENTION_DAYS },
      "Purged old notifications",
    )
  }

  const now = new Date()
  let cleared = 0
  for (;;) {
    const batchCleared = await purgeOrderNotificationLogs({
      now,
      limit: BATCH_SIZE,
    })
    cleared += batchCleared
    if (batchCleared < BATCH_SIZE) {
      break
    }
  }
  if (cleared > 0) {
    logger.info(
      { cleared, retentionDays: 30 },
      "Cleared expired order-notification logs",
    )
  }
}
