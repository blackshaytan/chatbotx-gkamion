export type HermesSseEvent = {
  id: number | null
  data: { event?: string; [key: string]: unknown }
}

const FRAME_SEPARATOR = "\n\n"
const STREAM_CLOSED_MARKER = "stream closed"

const isEventPayload = (value: unknown): value is HermesSseEvent["data"] =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Incremental Server-Sent Events parser for the Hermes `/events` stream.
 * Feed raw text chunks with `push`; complete frames are returned as parsed events.
 */
export const createSseParser = () => {
  let buffer = ""
  let closed = false

  const parseFrame = (frame: string): HermesSseEvent | null => {
    let id: number | null = null
    const dataLines: string[] = []

    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) {
        if (line.includes(STREAM_CLOSED_MARKER)) {
          closed = true
        }
        continue
      }
      if (line.startsWith("id:")) {
        const parsed = Number.parseInt(line.slice(3).trim(), 10)
        id = Number.isNaN(parsed) ? null : parsed
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart())
      }
    }

    if (dataLines.length === 0) {
      return null
    }

    let payload: unknown
    try {
      payload = JSON.parse(dataLines.join("\n"))
    } catch {
      return null
    }
    return isEventPayload(payload) ? { id, data: payload } : null
  }

  const push = (chunk: string): HermesSseEvent[] => {
    // Normalize after concatenation so a CR split across two chunks still pairs with its LF.
    buffer = (buffer + chunk).replaceAll("\r\n", "\n")
    const frames = buffer.split(FRAME_SEPARATOR)
    buffer = frames.pop() ?? ""
    return frames
      .map(parseFrame)
      .filter((event): event is HermesSseEvent => event !== null)
  }

  return { push, isClosed: () => closed }
}
