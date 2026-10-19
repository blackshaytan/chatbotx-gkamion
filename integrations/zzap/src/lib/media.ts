import { ZZAP_FILE_HOSTS } from "../constants"

const FILE_TAG_PATTERN = /\[file\]([^;\]]+);\s*([^\]]+)\[\/file\]/i
const IMG_TAG_PATTERN = /\[img\]\s*(https?:\/\/[^\s[\]]+)\s*(?:\[\/img\])?/i
const IMAGE_EXT_PATTERN = /\.(jpe?g|png|gif|webp|bmp|heic)(?:\?|$)/i
const MAX_URL_LENGTH = 2048

export type ZzapMedia = {
  url: string
  filename: string
  kind: "image" | "file"
}

const filenameFromUrl = (value: string): string => {
  try {
    const name = new URL(value).pathname.split("/").pop() ?? ""
    return decodeURIComponent(name) || "file"
  } catch {
    return "file"
  }
}

/** Only ZZAP's own file hosts, over https — the URL comes from buyer chat. */
export const isAllowedZzapFileUrl = (value: string): boolean => {
  if (value.length > MAX_URL_LENGTH) {
    return false
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== "https:" || url.pathname.includes("..")) {
    return false
  }
  const host = url.hostname.toLowerCase()
  if ((ZZAP_FILE_HOSTS as readonly string[]).includes(host)) {
    return true
  }
  if (host.endsWith(".zzap.ru") || host.endsWith(".zzap.pro")) {
    return true
  }
  return (
    host.endsWith(".blob.core.windows.net") &&
    url.pathname.includes("/zzap-upload/")
  )
}

/** Strips the first `[file]…[/file]` or `[img]…[/img]` tag from ZZAP text. */
export const parseZzapMedia = (
  raw: string,
): { text: string; media: ZzapMedia | null } => {
  const file = FILE_TAG_PATTERN.exec(raw)
  if (file) {
    const url = (file[2] ?? "").trim()
    const filename = (file[1] ?? "").trim() || filenameFromUrl(url)
    const isImage =
      IMAGE_EXT_PATTERN.test(filename) || IMAGE_EXT_PATTERN.test(url)
    return {
      text: raw.replace(file[0], "").trim(),
      media: { url, filename, kind: isImage ? "image" : "file" },
    }
  }
  const img = IMG_TAG_PATTERN.exec(raw)
  if (img) {
    const url = (img[1] ?? "").trim()
    return {
      text: raw.replace(img[0], "").trim(),
      media: { url, filename: filenameFromUrl(url), kind: "image" },
    }
  }
  return { text: raw.trim(), media: null }
}
