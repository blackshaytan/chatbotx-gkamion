import { normalizePhoneToE164 } from "./phone"

export type SameClientIdentity = {
  id: string
  createdAt: Date
  phoneNumber: string | null
  email: string | null
}

/** Forms of a phone that can already be stored on a contact. */
export const phoneCandidates = (raw: string | null | undefined): string[] => {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return []
  }
  const values = new Set<string>([trimmed])
  const addNormalized = (value: string) => {
    const normalized = normalizePhoneToE164(value, null)
    if (normalized) {
      values.add(normalized)
    }
  }
  addNormalized(trimmed)
  const digits = trimmed.replace(/[^\d]/g, "")
  if (digits.length >= 8 && !trimmed.startsWith("+")) {
    addNormalized(`+${digits}`)
  }
  return [...values]
}

export const normalizeEmail = (
  raw: string | null | undefined,
): string | null => {
  const trimmed = raw?.trim().toLowerCase()
  return trimmed ? trimmed : null
}

/**
 * The contact that stays. The older card wins so an existing dialog keeps its
 * id; a tie breaks on the smaller id so the choice is stable.
 */
export const pickSurvivor = <T extends { id: string; createdAt: Date }>(
  contacts: readonly T[],
): T => {
  const ranked = [...contacts].sort((left, right) => {
    const byTime = left.createdAt.getTime() - right.createdAt.getTime()
    if (byTime !== 0) {
      return byTime
    }
    if (BigInt(left.id) < BigInt(right.id)) {
      return -1
    }
    if (BigInt(left.id) > BigInt(right.id)) {
      return 1
    }
    return 0
  })
  const survivor = ranked[0]
  if (!survivor) {
    throw new Error("No contact to keep")
  }
  return survivor
}

/**
 * Phone wins over email. An email match is used only when the phone matches
 * nobody, so two people who share a mailbox but not a phone stay apart.
 */
export const matchingContacts = (
  contacts: readonly SameClientIdentity[],
  identity: { phoneNumber?: string | null; email?: string | null },
): SameClientIdentity[] => {
  const phones = new Set(phoneCandidates(identity.phoneNumber))
  if (phones.size > 0) {
    const byPhone = contacts.filter(
      (contact) =>
        contact.phoneNumber !== null && phones.has(contact.phoneNumber),
    )
    if (byPhone.length > 0) {
      return byPhone
    }
  }
  const email = normalizeEmail(identity.email)
  if (!email) {
    return []
  }
  return contacts.filter((contact) => normalizeEmail(contact.email) === email)
}
