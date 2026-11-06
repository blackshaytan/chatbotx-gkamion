/**
 * Illustrated stand-ins for a contact who has no photo of their own.
 * Files live in `apps/builder/public/contact-avatars/` (DiceBear Lorelei,
 * CC0). A stored key is this prefix plus `01.svg`…`36.svg`.
 */
export const CONTACT_AVATAR_PACK_SIZE = 36
export const CONTACT_AVATAR_PACK_PREFIX = "contact-avatars/"

export const contactAvatarPackKey = (index: number): string => {
  const size = CONTACT_AVATAR_PACK_SIZE
  const normalized = ((index % size) + size) % size
  return `${CONTACT_AVATAR_PACK_PREFIX}${String(normalized + 1).padStart(2, "0")}.svg`
}

export const isContactAvatarPackKey = (
  avatar: string | null | undefined,
): avatar is string =>
  !!avatar &&
  (avatar.startsWith(CONTACT_AVATAR_PACK_PREFIX) ||
    avatar.startsWith(`/${CONTACT_AVATAR_PACK_PREFIX}`))

/** Same contact id always picks the same picture. */
export const pickContactAvatarPackKey = (seed: string): string => {
  let hash = 0
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003
  }
  return contactAvatarPackKey(hash)
}
