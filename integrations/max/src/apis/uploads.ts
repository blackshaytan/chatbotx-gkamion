import { MaxException } from "../exception"
import { createMaxClient } from "../lib/http-client"
import type { MaxAttachmentRequest } from "../schema"

export type MaxMediaKind = "image" | "video" | "audio" | "file"

type UploadSlot = { url: string; token?: string }

/**
 * Images go by URL; MAX needs an upload for video/audio/file:
 * POST /uploads?type= → multipart `data` to the returned URL → token
 * (video/audio: token from step 1; file: token from the upload response).
 */
export const toMaxMediaAttachment = async (props: {
  token: string
  kind: MaxMediaKind
  url: string
  filename?: string
}): Promise<MaxAttachmentRequest> => {
  if (props.kind === "image") {
    return { type: "image", payload: { url: props.url } }
  }
  const slot = await createMaxClient(props.token).post<UploadSlot>("uploads", {
    searchParams: { type: props.kind },
  })
  const source = await fetch(props.url)
  if (!source.ok) {
    throw new MaxException(`Failed to download media (${source.status})`)
  }
  const form = new FormData()
  form.append(
    "data",
    new Blob([await source.arrayBuffer()]),
    props.filename ?? "file",
  )
  const uploaded = await fetch(slot.url, { method: "POST", body: form })
  if (!uploaded.ok) {
    throw new MaxException(`MAX upload failed (${uploaded.status})`)
  }
  const token =
    props.kind === "file"
      ? ((await uploaded.json()) as { token?: string }).token
      : slot.token
  if (!token) {
    throw new MaxException("MAX upload returned no token")
  }
  return { type: props.kind, payload: { token } }
}
