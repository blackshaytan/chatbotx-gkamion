import { taskService } from "@chatbotx.io/business"
import { uploader } from "@chatbotx.io/filesystem"
import { type NextRequest, NextResponse } from "next/server"
import { resolveMediaRequest } from "../../media-proxy"

type RouteContext = { params: Promise<{ token: string }> }

const parseAttachmentRef = (
  refId: string,
): { messageId: string; index: number } | null => {
  const separator = refId.lastIndexOf(":")
  if (separator <= 0) {
    return null
  }
  const messageId = refId.slice(0, separator)
  const index = Number(refId.slice(separator + 1))
  if (!(messageId && Number.isInteger(index)) || index < 0) {
    return null
  }
  return { messageId, index }
}

export const GET = async (request: NextRequest, context: RouteContext) => {
  const { token } = await context.params
  const resolvedRequest = await resolveMediaRequest({
    kind: "taskAttachment",
    request,
    token,
  })
  if (resolvedRequest instanceof NextResponse) {
    return resolvedRequest
  }

  const ref = parseAttachmentRef(resolvedRequest.refId)
  if (!ref) {
    return new NextResponse(null, { status: 404 })
  }

  const attachment = await taskService.findAttachment({
    workspaceId: resolvedRequest.workspaceId,
    messageId: ref.messageId,
    index: ref.index,
  })
  if (!attachment) {
    return new NextResponse(null, { status: 404 })
  }

  let body: Buffer
  try {
    body = await uploader.getObject(attachment.key)
  } catch {
    return new NextResponse(null, { status: 404 })
  }
  const encodedName = encodeURIComponent(attachment.name)

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "private, max-age=300",
    },
  })
}
