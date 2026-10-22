import { getPublicFileUrl } from "@chatbotx.io/utils"
import { hasRealAvatar } from "@chatbotx.io/utils/no-avatar-sentinel"
import { useTenantSettings } from "@/features/tenant"

type ContactInboxReadTimestamp = {
  contactLastReadAt?: Date | null
}

export function getLatestContactLastReadAt(
  contactInboxes?: ContactInboxReadTimestamp[] | null,
): Date | null {
  return (
    contactInboxes
      ?.map((contactInbox) => contactInbox.contactLastReadAt)
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  )
}

const ABSOLUTE_URL_RE = /^https?:\/\//i
const AVATAR_PROXY_PATH_RE = /\/media\/avatar\//i

/**
 * Provider CDN URLs (Telegram `api.telegram.org/file/…`, Graph lookaside, …)
 * expire and/or send `Content-Disposition: attachment`, so `<img>` cannot
 * display them. Only durable storage keys and our `/media/avatar/` proxy are
 * safe as an image `src`.
 */
const isBrowserSafeAvatarSrc = (avatar: string): boolean => {
  if (!ABSOLUTE_URL_RE.test(avatar)) {
    return true
  }
  return AVATAR_PROXY_PATH_RE.test(avatar)
}

export function useAvatarUrl(
  contact?: { avatar?: string | null } | null,
): string | undefined {
  const { storageUrl } = useTenantSettings()
  if (!contact) {
    return
  }

  // A no-avatar sentinel (`no_avatar.jpg?time=…`) is a "we tried and there is no
  // avatar" marker, not a real key — finalizing it would render a broken image,
  // so fall back to the initials avatar instead.
  if (
    !(hasRealAvatar(contact.avatar) && isBrowserSafeAvatarSrc(contact.avatar))
  ) {
    return
  }
  return getPublicFileUrl(contact.avatar, storageUrl)
}
