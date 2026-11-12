const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heic",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "application/pdf": "pdf",
}

/** A trailing `.jpg`-style suffix. Names like `1794_default` have none. */
const FILE_EXTENSION_RE = /\.[a-z0-9]{2,5}$/i

export const extensionForMimeType = (mimeType: string): string | null => {
  const mime = mimeType.toLowerCase().split(";")[0]?.trim() ?? ""
  return MIME_EXTENSIONS[mime] ?? null
}

/**
 * Keep a name that already has an extension. Otherwise append one from the
 * MIME type, so a download is not saved as an extensionless unknown file.
 */
export const filenameWithMimeExtension = (
  name: string,
  mimeType: string,
): string => {
  const trimmed = name.trim() || "file"
  if (FILE_EXTENSION_RE.test(trimmed)) {
    return trimmed
  }
  const extension = extensionForMimeType(mimeType)
  if (!extension) {
    return trimmed
  }
  return `${trimmed}.${extension}`
}
