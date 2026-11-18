/**
 * After ChatbotX accepts an order notification by email, ask n8n to place
 * the voice call. A messenger acceptance, a missing status, or missing
 * configuration produces no request. Failures are logged and never retried:
 * the email has already been sent.
 */

const VOICE_EMAIL_STATUSES = new Set([13, 16, 22])
const CALLBACK_TIMEOUT_MS = 10000

export type VoiceEmailCallbackRequest = {
  url: string
  secret: string
  body: string
}

export function voiceEmailCallbackRequest(input: {
  acceptedChannel: string | null
  statusId?: number
  orderId?: string
  url?: string
  secret?: string
}): VoiceEmailCallbackRequest | null {
  if (input.acceptedChannel !== "smtp") return null
  if (input.statusId == null || !VOICE_EMAIL_STATUSES.has(input.statusId)) {
    return null
  }
  const orderId = String(input.orderId ?? "").trim()
  const url = String(input.url ?? "").trim()
  const secret = String(input.secret ?? "").trim()
  if (!orderId || !url || !secret || !Number.isFinite(Number(orderId))) {
    return null
  }
  return {
    url,
    secret,
    body: JSON.stringify({
      order_id: Number(orderId),
      status_id: input.statusId,
      email_delivered: true,
    }),
  }
}

export async function postVoiceEmailCallback(
  request: VoiceEmailCallbackRequest,
  fetchImpl: typeof fetch,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Voice-Secret": request.secret,
      },
      body: request.body,
      signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
    })
    if (!response.ok) {
      onError(new Error(`voice callback HTTP ${response.status}`))
      return
    }
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
    if (payload && payload.ok === false) {
      onError(new Error(String(payload.error || "voice callback rejected")))
    }
  } catch (error) {
    onError(error)
  }
}
