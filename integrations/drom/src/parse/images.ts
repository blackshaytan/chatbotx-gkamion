import { decodeEntities } from "./html"

export type DromImage = { url: string; origUrl: string }

const MAX_URL_LENGTH = 1024
const IMG_TAG = /<img\b([^>]*)>/gi
const SRC = /\bsrc="([^"]+)"/i
const ORIG_SRC = /\bdata-orig-src="([^"]+)"/i

/** Chat photos: the legacy CDN or signed `/p-img/` on baza.drom.ru. */
export const isDromImageUrl = (url: string): boolean => {
  const raw = (url ?? "").trim()
  if (!raw || raw.length > MAX_URL_LENGTH || raw.includes("..")) {
    return false
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  if (host === "static.baza.drom.ru") {
    return parsed.pathname.startsWith("/")
  }
  if (host === "baza.drom.ru") {
    return parsed.pathname.startsWith("/p-img/")
  }
  return false
}

const attribute = (attrs: string, pattern: RegExp): string => {
  const value = pattern.exec(attrs)?.[1]
  return value ? decodeEntities(value).trim() : ""
}

export const parseMessageImages = (html: string): DromImage[] => {
  const images: DromImage[] = []
  const seen = new Set<string>()
  for (const tag of (html ?? "").matchAll(IMG_TAG)) {
    const attrs = tag[1] ?? ""
    const src = attribute(attrs, SRC)
    const orig = attribute(attrs, ORIG_SRC)
    const url = orig || src
    if (!(isDromImageUrl(url) && !seen.has(url))) {
      continue
    }
    seen.add(url)
    images.push({ url: src || url, origUrl: url })
  }
  return images
}
