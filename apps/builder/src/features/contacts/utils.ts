import { getPublicFileUrl } from "@chatbotx.io/utils"
import {
  isContactAvatarPackKey,
  pickContactAvatarPackKey,
} from "@chatbotx.io/utils/contact-avatar-pack"
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
const LEADING_SLASHES_RE = /^\/+/
const AVATAR_PROXY_PATH_RE = /\/media\/avatar\//i

/**
 * Provider CDN URLs (Telegram `api.telegram.org/file/…`, Graph lookaside, …)
 * expire and/or send `Content-Disposition: attachment`, so `<img>` cannot
 * display them. Only durable storage keys and our `/media/avatar/` proxy are
 * safe as an image `src`.
 */
const isBrowserSafeAvatarSrc = (avatar: string): boolean => {
  if (isContactAvatarPackKey(avatar) || avatar.includes("/contact-avatars/")) {
    return true
  }
  if (!ABSOLUTE_URL_RE.test(avatar)) {
    return true
  }
  return AVATAR_PROXY_PATH_RE.test(avatar)
}

const packAvatarSrc = (avatar: string): string => {
  if (ABSOLUTE_URL_RE.test(avatar)) {
    return avatar
  }
  return `/${avatar.replace(LEADING_SLASHES_RE, "")}`
}

const fallbackPackSrc = (contact: {
  id?: string | null
  firstName?: string | null
  lastName?: string | null
}): string => {
  const seed =
    contact.id ||
    `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() ||
    "contact"
  return `/${pickContactAvatarPackKey(seed)}`
}

export function useAvatarUrl(
  contact?: {
    id?: string | null
    avatar?: string | null
    firstName?: string | null
    lastName?: string | null
  } | null,
): string | undefined {
  const { storageUrl } = useTenantSettings()
  if (!contact) {
    return
  }

  // A no-avatar sentinel (`no_avatar.jpg?time=…`) is a "we tried and there is no
  // avatar" marker, not a real key — finalizing it would render a broken image.
  // A contact with no photo of their own gets a stable picture from the pack.
  if (
    !(hasRealAvatar(contact.avatar) && isBrowserSafeAvatarSrc(contact.avatar))
  ) {
    return fallbackPackSrc(contact)
  }
  if (
    isContactAvatarPackKey(contact.avatar) ||
    contact.avatar.includes("/contact-avatars/")
  ) {
    return packAvatarSrc(contact.avatar)
  }
  return getPublicFileUrl(contact.avatar, storageUrl)
}
