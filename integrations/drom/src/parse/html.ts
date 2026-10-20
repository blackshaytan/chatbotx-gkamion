const BR = /<br\s*\/?>/gi
const TAG = /<[^>]+>/g
const SPACES = /[ \t]+/g
const ENTITY = /&(#x[\da-f]+|#\d+|[a-z]+);/gi
const SPAN_OPEN = /<span\b/gi
const SPAN_CLOSE = /<\/span>/gi
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  laquo: "«",
  lt: "<",
  mdash: "—",
  nbsp: "\u00a0",
  ndash: "–",
  quot: '"',
  raquo: "»",
}

const fromCodePoint = (code: number, fallback: string): string =>
  Number.isFinite(code) && code > 0 && code <= 0x10_ff_ff
    ? String.fromCodePoint(code)
    : fallback

export const decodeEntities = (text: string): string =>
  text.replace(ENTITY, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return fromCodePoint(Number.parseInt(body.slice(2), 16), match)
    }
    if (body.startsWith("#")) {
      return fromCodePoint(Number.parseInt(body.slice(1), 10), match)
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })

/** `<br>` → line break, tags dropped, runs of spaces collapsed, entities decoded. */
export const stripTags = (html: string): string =>
  decodeEntities(
    (html ?? "").replace(BR, "\n").replace(TAG, "").replace(SPACES, " "),
  ).trim()

const searchFrom = (pattern: RegExp, text: string, from: number) => {
  pattern.lastIndex = from
  return pattern.exec(text)
}

/** Inner HTML up to the `</span>` matching an already opened span. */
const matchingSpanInner = (
  html: string,
  start: number,
): { inner: string; end: number } => {
  let depth = 1
  let index = start
  while (index < html.length && depth > 0) {
    const open = searchFrom(SPAN_OPEN, html, index)
    const close = searchFrom(SPAN_CLOSE, html, index)
    if (!close) {
      return { inner: html.slice(start), end: html.length }
    }
    if (open && open.index < close.index) {
      depth += 1
      index = open.index + open[0].length
      continue
    }
    depth -= 1
    if (depth === 0) {
      return {
        inner: html.slice(start, close.index),
        end: close.index + close[0].length,
      }
    }
    index = close.index + close[0].length
  }
  return { inner: html.slice(start), end: html.length }
}

/** Inner HTML of each `<span class="className…">`, nested spans kept. */
export const spanInnersByClass = (
  html: string,
  className: string,
): string[] => {
  const pattern = new RegExp(
    `<span[^>]*class="${className.replace(REGEX_SPECIAL, "\\$&")}[^"]*"[^>]*>`,
    "gis",
  )
  const out: string[] = []
  let position = 0
  for (;;) {
    const match = searchFrom(pattern, html, position)
    if (!match) {
      return out
    }
    const openEnd = match.index + match[0].length
    const { inner, end } = matchingSpanInner(html, openEnd)
    out.push(inner)
    position = Math.max(end, openEnd)
  }
}
