import { conversationService } from "@chatbotx.io/business"
import { getChildLogger } from "@chatbotx.io/logger"
import {
  distributedLock,
  distributedStore,
  isLockAcquisitionError,
} from "@chatbotx.io/redis"

const LOCK_KEY = "schedule:resume-due-bots"
const log = getChildLogger("resume-due-bots")
const LOCK_TTL_SECONDS = 50
const LOCK_ACQUIRE_RETRY_SECONDS = 5
const BATCH_SIZE = 200
const MAX_BATCHES_PER_RUN = 10
let isResumeDueBotsRunning = false

export async function resumeDueBots(): Promise<void> {
  if (isResumeDueBotsRunning) {
    log.warn("resumeDueBots: skipped because a local run is still in progress")
    return
  }

  isResumeDueBotsRunning = true
  try {
    await distributedLock.runExclusive({
      key: LOCK_KEY,
      timeoutInSeconds: LOCK_TTL_SECONDS,
      retryTimeoutInSeconds: LOCK_ACQUIRE_RETRY_SECONDS,
      fn: async () => {
        let resumed = 0
        let lastBatch = 0
        for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
          lastBatch = await conversationService.resumeDueBots({
            limit: BATCH_SIZE,
          })
          resumed += lastBatch
          if (lastBatch < BATCH_SIZE) {
            break
          }
        }

        if (resumed > 0) {
          log.info({ resumed }, "resumeDueBots: paused bots resumed")
        }
        if (lastBatch === BATCH_SIZE) {
          log.warn(
            { resumed, batchSize: BATCH_SIZE, maxBatches: MAX_BATCHES_PER_RUN },
            "resumeDueBots: per-run batch cap hit; backlog remains for the next tick",
          )
        }
      },
    })
  } catch (err) {
    if (
      isLockAcquisitionError(err, LOCK_KEY) &&
      (await distributedStore.exists(LOCK_KEY))
    ) {
      log.warn(
        { err },
        "resumeDueBots: skipped because another run still holds the lock",
      )
      return
    }

    throw err
  } finally {
    isResumeDueBotsRunning = false
  }
}
