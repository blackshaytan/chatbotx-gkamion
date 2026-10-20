import { DromAPIException, DromException } from "../exception"
import { createDromClient } from "../lib/http-client"
import { isDromImageUrl } from "../parse"
import type { DromAuthValue } from "../schema"

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
  const { bytes, mime } = await createDromClient(auth).getBinary(url)
  const filename = new URL(url).pathname.split("/").pop() || "drom_photo"
  return { bytes, mime, filename }
}
