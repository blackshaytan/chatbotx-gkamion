import {
  contactInboxService,
  contactService,
  isNoAvatarSentinelFresh,
  isPendingOriginPath,
  parseNoAvatarSentinel,
  resolveTenantSettings,
} from "@chatbotx.io/business"
import { getPublicFileUrl } from "@chatbotx.io/business/utils"
import { resolveFreshContactAvatarUrl } from "@chatbotx.io/channel-registry/media-hydration"
import { toLogSafeError } from "@chatbotx.io/logger"
import { type NextRequest, NextResponse } from "next/server"
import { httpLogger } from "@/lib/log"
import {
  enqueueAvatarMirror,
  isTerminalMediaError,
  placeholderUrl,
  resolveMediaRequest,
} from "../../media-proxy"

type RouteContext = { params: Promise<{ token: string }> }

const AVATAR_FETCH_TIMEOUT_MS = 15_000
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const
const GIF_MAGIC = [0x47, 0x49, 0x46] as const
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46] as const

const sniffImageMimeType = (
  bytes: Uint8Array,
  declared: string | null,
): string => {
  if (
    declared?.startsWith("image/") &&
    declared !== "application/octet-stream"
  ) {
    return declared
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === JPEG_MAGIC[0] &&
    bytes[1] === JPEG_MAGIC[1] &&
    bytes[2] === JPEG_MAGIC[2]
  ) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === PNG_MAGIC[0] &&
    bytes[1] === PNG_MAGIC[1] &&
    bytes[2] === PNG_MAGIC[2] &&
    bytes[3] === PNG_MAGIC[3]
  ) {
    return "image/png"
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === GIF_MAGIC[0] &&
    bytes[1] === GIF_MAGIC[1] &&
    bytes[2] === GIF_MAGIC[2]
  ) {
    return "image/gif"
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === WEBP_RIFF[0] &&
    bytes[1] === WEBP_RIFF[1] &&
    bytes[2] === WEBP_RIFF[2] &&
    bytes[3] === WEBP_RIFF[3]
  ) {
    return "image/webp"
  }
  return "image/jpeg"
}

/**
 * Telegram (and some other providers) serve profile photos with
 * `Content-Disposition: attachment` / `application/octet-stream`. A 302 to
 * that URL makes `<img>` fail in the browser — stream the bytes ourselves
 * with an image Content-Type instead.
 */
const respondWithExternalAvatar = async (
  freshAvatarUrl: string,
  placeholder: () => NextResponse,
): Promise<NextResponse> => {
  try {
    const upstream = await fetch(freshAvatarUrl, {
      signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "node" },
      redirect: "follow",
    })
    if (!upstream.ok) {
      return placeholder()
    }
    const buffer = new Uint8Array(await upstream.arrayBuffer())
    if (buffer.byteLength === 0) {
      return placeholder()
    }
    const mimeType = sniffImageMimeType(
      buffer,
      upstream.headers.get("content-type"),
    )
    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=300",
      },
    })
  } catch {
    return placeholder()
  }
}

export const GET = async (request: NextRequest, context: RouteContext) => {
  const { token } = await context.params
  const resolvedRequest = await resolveMediaRequest({
    kind: "avatar",
    request,
    token,
  })
  if (resolvedRequest instanceof NextResponse) {
    return resolvedRequest
  }

  const placeholder = () =>
    NextResponse.redirect(placeholderUrl(request, "default-avatar.svg"), 302)

  const contactInbox = await contactInboxService.findByUncached({
    where: { id: resolvedRequest.refId },
  })
  if (!contactInbox) {
    return placeholder()
  }
  const contact = await contactService.findById({
    workspaceId: resolvedRequest.workspaceId,
    id: contactInbox.contactId,
  })
  if (!contact) {
    return placeholder()
  }

  // Mirror once after a fresh resolve so a later render either recovers the
  // avatar or persists the no-avatar sentinel, instead of re-hitting Graph.
  const mirror = () =>
    enqueueAvatarMirror({
      workspaceId: resolvedRequest.workspaceId,
      contactInboxId: contactInbox.id,
      sourceId: contactInbox.sourceId,
    })

  if (contact.avatar) {
    const sentinel = parseNoAvatarSentinel(contact.avatar)
    if (!sentinel) {
      // Durable mirrored key → storage. Transient provider URLs (Telegram
      // file links, Graph lookaside, …) expire — re-fetch a fresh one below.
      if (!isPendingOriginPath(contact.avatar)) {
        const { storageUrl } = await resolveTenantSettings({
          workspaceId: resolvedRequest.workspaceId,
        })
        return NextResponse.redirect(
          getPublicFileUrl(contact.avatar, storageUrl),
          302,
        )
      }
    } else if (isNoAvatarSentinelFresh(sentinel.failedAtMs)) {
      // Fresh no-avatar: serve the guaranteed placeholder, not the stored
      // sentinel key which may be absent from the tenant's bucket.
      return placeholder()
    }
  }

  try {
    const freshAvatarUrl = await resolveFreshContactAvatarUrl({
      contactInboxId: contactInbox.id,
      workspaceId: resolvedRequest.workspaceId,
    })
    mirror()
    if (!freshAvatarUrl) {
      return placeholder()
    }
    return await respondWithExternalAvatar(freshAvatarUrl, placeholder)
  } catch (err) {
    // Terminal (the fetch will keep failing) or a transient provider/network
    // blip — either way degrade to the placeholder instead of a 502 and mirror
    // once; only the unexpected transient case is worth logging.
    if (!isTerminalMediaError(err)) {
      httpLogger.error(
        { err: toLogSafeError(err), contactInboxId: contactInbox.id },
        "Failed to resolve fresh contact avatar URL; serving placeholder",
      )
    }
    mirror()
    return placeholder()
  }
}
