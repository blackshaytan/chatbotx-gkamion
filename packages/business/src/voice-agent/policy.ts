import { and, db, eq } from "@chatbotx.io/database/client"
import type { AiCallOptOutSource } from "@chatbotx.io/database/partials"
import { contactModel } from "@chatbotx.io/database/schema"

import { normalizePhoneToE164 } from "../contact/phone"
import { workspaceService } from "../workspace/service"

export type VoiceCallPolicyResult =
  | { canCall: true; contactIds: string[] }
  | {
      canCall: false
      reason: "optedOut" | "blocked" | "invalidPhone"
      contactId?: string
      optOutAt?: Date
      optOutSource?: AiCallOptOutSource
    }

function asOptOutSource(value: string | null): AiCallOptOutSource | undefined {
  if (value === "clientCall" || value === "clientChat" || value === "manager") {
    return value
  }
  return
}

export async function resolveVoiceCallPolicy(input: {
  workspaceId: string
  phone: string
}): Promise<VoiceCallPolicyResult> {
  const workspace = await workspaceService.find({
    where: { id: input.workspaceId },
  })
  if (!workspace) {
    throw new Error(`Workspace not found: ${input.workspaceId}`)
  }

  let phone: string | null
  try {
    phone = normalizePhoneToE164(input.phone, workspace.targetCountry)
  } catch {
    return { canCall: false, reason: "invalidPhone" }
  }

  if (!phone) {
    return { canCall: false, reason: "invalidPhone" }
  }

  const contacts = await db
    .select({
      id: contactModel.id,
      aiCallOptOutAt: contactModel.aiCallOptOutAt,
      aiCallOptOutSource: contactModel.aiCallOptOutSource,
      blockedAt: contactModel.blockedAt,
    })
    .from(contactModel)
    .where(
      and(
        eq(contactModel.workspaceId, input.workspaceId),
        eq(contactModel.phoneNumber, phone),
      ),
    )

  const optedOut = contacts
    .filter((c) => c.aiCallOptOutAt)
    .sort((a, b) => {
      const aTime = a.aiCallOptOutAt?.getTime() ?? 0
      const bTime = b.aiCallOptOutAt?.getTime() ?? 0
      return aTime - bTime
    })

  if (optedOut[0]) {
    return {
      canCall: false,
      reason: "optedOut",
      contactId: optedOut[0].id,
      optOutAt: optedOut[0].aiCallOptOutAt ?? undefined,
      optOutSource: asOptOutSource(optedOut[0].aiCallOptOutSource),
    }
  }

  const blocked = contacts.find((c) => c.blockedAt)
  if (blocked) {
    return { canCall: false, reason: "blocked", contactId: blocked.id }
  }

  return { canCall: true, contactIds: contacts.map((c) => c.id) }
}
