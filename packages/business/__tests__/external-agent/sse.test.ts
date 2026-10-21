import { describe, expect, test } from "vitest"
import { createSseParser } from "../../src/external-agent/sse"

describe("createSseParser", () => {
  test("ignores comments and returns parsed frames with ids", () => {
    const parser = createSseParser()

    const events = parser.push(
      ': open\n\nid: 3\ndata: {"event":"message.interim","text":"Ищу"}\n\n',
    )

    expect(events).toEqual([
      { id: 3, data: { event: "message.interim", text: "Ищу" } },
    ])
    expect(parser.isClosed()).toBe(false)
  })

  test("joins a frame split across two chunks", () => {
    const parser = createSseParser()

    expect(parser.push('id: 4\ndata: {"event":"tool.started"')).toEqual([])
    expect(parser.push(',"run_id":"r1"}\n\n')).toEqual([
      { id: 4, data: { event: "tool.started", run_id: "r1" } },
    ])
  })

  test("handles a CRLF pair split across chunks", () => {
    const parser = createSseParser()

    expect(parser.push('id: 5\r\ndata: {"event":"x"}\r')).toEqual([])
    expect(parser.push("\n\r\n")).toEqual([{ id: 5, data: { event: "x" } }])
  })

  test("reports closed on the stream closed comment", () => {
    const parser = createSseParser()

    expect(parser.push(": stream closed\n\n")).toEqual([])
    expect(parser.isClosed()).toBe(true)
  })

  test("parses a replay.truncated frame without an id line", () => {
    const parser = createSseParser()

    expect(
      parser.push('data: {"event":"replay.truncated","run_id":"r1"}\n\n'),
    ).toEqual([{ id: null, data: { event: "replay.truncated", run_id: "r1" } }])
  })

  test("skips keepalive comments and malformed JSON frames", () => {
    const parser = createSseParser()

    expect(
      parser.push(
        ": keepalive\n\nid: 6\ndata: {not json}\n\nid: 7\ndata: 42\n\n",
      ),
    ).toEqual([])
    expect(parser.isClosed()).toBe(false)
  })
})
