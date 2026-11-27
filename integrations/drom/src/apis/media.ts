import { filenameWithMimeExtension } from "@chatbotx.io/utils/file-name"
import { DromAPIException, DromException } from "../exception"
import { createDromClient } from "../lib/http-client"
import { isDromImageUrl } from "../parse"
import type { DromAuthValue } from "../schema"

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const
const GIF_MAGIC = [0x47, 0x49, 0x46] as const
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46] as const
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50] as const

const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  bytes.length >= magic.length &&
  magic.every((byte, index) => bytes[index] === byte)

/** Magic bytes win over a missing or generic Content-Type. */
const resolveImageMime = (bytes: Uint8Array, declared: string): string => {
  if (startsWith(bytes, JPEG_MAGIC)) {
    return "image/jpeg"
  }
  if (startsWith(bytes, PNG_MAGIC)) {
    return "image/png"
  }
  if (startsWith(bytes, GIF_MAGIC)) {
    return "image/gif"
  }
  if (
    startsWith(bytes, WEBP_RIFF) &&
    bytes.length >= 12 &&
    WEBP_TAG.every((byte, index) => bytes[index + 8] === byte)
  ) {
    return "image/webp"
  }
  const mime = declared.split(";")[0]?.trim().toLowerCase()
  return mime || "application/octet-stream"
}

type UploadItem = { id?: unknown }
type UploadResponse = UploadItem & { items?: unknown; error?: unknown }

const firstItem = (response: UploadResponse | null): UploadItem | null => {
  if (Array.isArray(response?.items)) {
    const [item] = response.items as unknown[]
    return typeof item === "object" && item !== null
      ? (item as UploadItem)
      : null
  }
  return response?.id === undefined ? null : response
}

/** Uploads one photo for the next send; the id goes into `images[<id>]`. */
export const uploadDromImage = async (
  auth: DromAuthValue,
  file: { name: string; mime: string; bytes: Uint8Array },
): Promise<{ imageId: string }> => {
  const response = await createDromClient(auth).postMultipart<UploadResponse>(
    "/upload-image-jquery",
    "up[]",
    file,
  )
  if (response?.error) {
    throw new DromAPIException(
      `DROM upload failed: ${String(response.error)}`,
      400,
      "uploadFailed",
    )
  }
  const id = firstItem(response)?.id
  if (id === undefined || id === null || String(id) === "") {
    throw new DromAPIException("no_image_id", 400, "uploadFailed")
  }
  return { imageId: String(id) }
}

/** Chat photos are signed and need the seller cookies to download. */
export const downloadDromImage = async (
  auth: DromAuthValue,
  url: string,
): Promise<{ bytes: Uint8Array; mime: string; filename: string }> => {
  if (!isDromImageUrl(url)) {
    throw new DromException(
      "DROM image URL is not allowed",
      400,
      "urlNotAllowed",
    )
  }
  const downloaded = await createDromClient(auth).getBinary(url)
  const mime = resolveImageMime(downloaded.bytes, downloaded.mime)
  const filename = filenameWithMimeExtension(
    new URL(url).pathname.split("/").pop() || "drom_photo",
    mime,
  )
  return { bytes: downloaded.bytes, mime, filename }
}
