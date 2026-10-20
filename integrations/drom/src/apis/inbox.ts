import { createDromClient } from "../lib/http-client"
import { type DromBrief, parseBriefs } from "../parse"
import type { DromAuthValue } from "../schema"

type InboxConfig = {
  hasDialogs?: unknown
  eventCounts?: { unreadDialogs?: unknown }
}

/** Cheapest authenticated call — also the cookie probe. */
export const getInboxConfig = async (
  auth: DromAuthValue,
): Promise<{ hasDialogs: boolean; unreadDialogs: number }> => {
  const config = await createDromClient(auth).getJson<InboxConfig>(
    "/personal/messaging/inbox-config",
  )
  return {
    hasDialogs: Boolean(config?.hasDialogs),
    unreadDialogs: Number(config?.eventCounts?.unreadDialogs ?? 0) || 0,
  }
}

export const listBriefs = async (auth: DromAuthValue): Promise<DromBrief[]> =>
  parseBriefs(
    await createDromClient(auth).getJson<unknown>(
      "/personal/messaging/inbox-list",
    ),
  )
