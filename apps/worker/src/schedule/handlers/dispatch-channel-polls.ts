import { listDuePolls } from "@chatbotx.io/connections"
import {
  buildChannelPollJobId,
  LowJobAction,
  lowQueue,
} from "@chatbotx.io/worker-config"

/**
 * Enqueues one `pollChannel` job per `connected` polling connection whose
 * interval elapsed. A connection that is switched off or needs reauth simply
 * drops out of the due list, so there is no per-connection scheduler to tear
 * down.
 */
export const dispatchChannelPolls = async (): Promise<void> => {
  const due = await listDuePolls()
  for (const { connectionId, workspaceId } of due) {
    await lowQueue.add(
      LowJobAction.pollChannel,
      { type: LowJobAction.pollChannel, data: { connectionId, workspaceId } },
      {
        jobId: buildChannelPollJobId(connectionId),
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      },
    )
  }
}
