import { describe, expect, test } from "vitest"

import {
  decideFallback,
  decideInterim,
  decideLimit,
  EXTERNAL_AGENT_INTERIM_MIN_INTERVAL_MS,
  EXTERNAL_AGENT_PROGRESS_FALLBACK_MS,
  EXTERNAL_AGENT_STALL_MS,
  resolveExternalAgentResumeAt,
} from "../../src/external-agent/progress"

const NOW = new Date("2026-10-21T10:00:00.000Z")
const msBefore = (ms: number) => new Date(NOW.getTime() - ms)

describe("constants", () => {
  test("match the documented intervals", () => {
    expect(EXTERNAL_AGENT_INTERIM_MIN_INTERVAL_MS).toBe(30_000)
    expect(EXTERNAL_AGENT_PROGRESS_FALLBACK_MS).toBe(90_000)
    expect(EXTERNAL_AGENT_STALL_MS).toBe(300_000)
  })
})

describe("decideInterim", () => {
  const base = {
    now: NOW,
    lastProgressSentAt: null,
    lastProgressText: null,
  }

  test("skips empty or whitespace text", () => {
    expect(decideInterim({ ...base, text: "" })).toBe("skip")
    expect(decideInterim({ ...base, text: "   \n" })).toBe("skip")
  })

  test("skips text equal to the last sent one, ignoring case and surrounding spaces", () => {
    expect(
      decideInterim({
        ...base,
        text: "  Ищу Данные ",
        lastProgressSentAt: msBefore(60_000),
        lastProgressText: "ищу данные",
      }),
    ).toBe("skip")
  })

  test("skips when the last send was less than 30 seconds ago", () => {
    expect(
      decideInterim({
        ...base,
        text: "Новый текст",
        lastProgressSentAt: msBefore(29_999),
        lastProgressText: "Старый текст",
      }),
    ).toBe("skip")
  })

  test("sends exactly 30 seconds after the last send", () => {
    expect(
      decideInterim({
        ...base,
        text: "Новый текст",
        lastProgressSentAt: msBefore(30_000),
        lastProgressText: "Старый текст",
      }),
    ).toBe("send")
  })

  test("sends fresh non-empty text when nothing was sent yet", () => {
    expect(decideInterim({ ...base, text: "Ищу" })).toBe("send")
  })
})

describe("decideFallback", () => {
  const base = {
    now: NOW,
    runStartedAt: msBefore(200_000),
    lastClientSendAt: null,
    progressFallbackSentAt: null,
    progressMessage: "Работаю над ответом",
  }

  test("returns false for an empty or null progress message", () => {
    expect(decideFallback({ ...base, progressMessage: null })).toBe(false)
    expect(decideFallback({ ...base, progressMessage: "  " })).toBe(false)
  })

  test("returns false when the fallback was already sent", () => {
    expect(
      decideFallback({ ...base, progressFallbackSentAt: msBefore(1000) }),
    ).toBe(false)
  })

  test("returns true after 90 seconds since run start with no client send", () => {
    expect(decideFallback({ ...base, runStartedAt: msBefore(90_000) })).toBe(
      true,
    )
  })

  test("returns false 1 ms before 90 seconds", () => {
    expect(decideFallback({ ...base, runStartedAt: msBefore(89_999) })).toBe(
      false,
    )
  })

  test("measures from the later of run start and last client send", () => {
    expect(
      decideFallback({
        ...base,
        runStartedAt: msBefore(200_000),
        lastClientSendAt: msBefore(10_000),
      }),
    ).toBe(false)
    expect(
      decideFallback({
        ...base,
        runStartedAt: msBefore(200_000),
        lastClientSendAt: msBefore(90_000),
      }),
    ).toBe(true)
  })
})

describe("decideLimit", () => {
  const base = {
    now: NOW,
    runStartedAt: msBefore(60_000),
    lastEventAt: msBefore(1000),
    maxRunMinutes: 10,
  }

  test("returns ok for a fresh active run", () => {
    expect(decideLimit(base)).toBe("ok")
  })

  test("returns overLimit exactly at maxRunMinutes", () => {
    expect(decideLimit({ ...base, runStartedAt: msBefore(10 * 60_000) })).toBe(
      "overLimit",
    )
  })

  test("returns ok 1 ms before maxRunMinutes", () => {
    expect(
      decideLimit({
        ...base,
        runStartedAt: msBefore(10 * 60_000 - 1),
        lastEventAt: msBefore(1000),
      }),
    ).toBe("ok")
  })

  test("checks overLimit before stalled", () => {
    expect(
      decideLimit({
        ...base,
        runStartedAt: msBefore(10 * 60_000),
        lastEventAt: msBefore(EXTERNAL_AGENT_STALL_MS),
      }),
    ).toBe("overLimit")
  })

  test("returns stalled exactly 5 minutes after the last event", () => {
    expect(
      decideLimit({ ...base, lastEventAt: msBefore(EXTERNAL_AGENT_STALL_MS) }),
    ).toBe("stalled")
  })

  test("returns ok 1 ms before the stall threshold", () => {
    expect(
      decideLimit({
        ...base,
        lastEventAt: msBefore(EXTERNAL_AGENT_STALL_MS - 1),
      }),
    ).toBe("ok")
  })

  test("measures stall from run start when no event was received", () => {
    expect(
      decideLimit({
        ...base,
        runStartedAt: msBefore(EXTERNAL_AGENT_STALL_MS),
        lastEventAt: null,
      }),
    ).toBe("stalled")
  })
})

describe("resolveExternalAgentResumeAt", () => {
  test("returns null when resumeAfterHours is null", () => {
    expect(resolveExternalAgentResumeAt(null, NOW)).toBeNull()
  })

  test("adds the given hours to now", () => {
    expect(resolveExternalAgentResumeAt(2, NOW)?.toISOString()).toBe(
      "2026-10-21T12:00:00.000Z",
    )
  })
})
