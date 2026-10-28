import { describe, expect, test } from "vitest"

import {
  EXTERNAL_AGENT_HANDOVER_CLOSED_TEXT,
  EXTERNAL_AGENT_HANDOVER_OPEN_TEXT,
  isExternalAgentHandoverWindowOpen,
  resolveExternalAgentHandoverClientText,
} from "../../src/external-agent/handover-text"

/**
 * The pickup point answers by Moscow working time: Mon–Fri 10:00–18:59:59.999,
 * Sat 12:00–15:59:59.999, Sun closed. Moscow is a fixed UTC+03:00 zone
 * (no daylight saving), so an MSK wall-clock string maps onto an absolute
 * instant without depending on the process time zone.
 */
const at = (msk: string): Date => new Date(`${msk}+03:00`)

describe("handover confirmation texts", () => {
  test("inside the working window the confirmation is the feminine handover text", () => {
    expect(EXTERNAL_AGENT_HANDOVER_OPEN_TEXT).toBe(
      "Я передала ваш запрос менеджеру",
    )
  })

  test("outside the working window the confirmation states the closing and the Moscow schedule", () => {
    expect(EXTERNAL_AGENT_HANDOVER_CLOSED_TEXT).toBe(
      "Сейчас нерабочее время пункта выдачи. График по Москве: Пн–Пт 10:00–19:00, Сб 12:00–16:00, Вс — выходной. Я уже передала ваш запрос менеджеру. Менеджер ответит вам в рабочее время.",
    )
  })

  test("the resolver follows the working window", () => {
    expect(
      resolveExternalAgentHandoverClientText(at("2026-10-21T14:30:00.000")),
    ).toBe(EXTERNAL_AGENT_HANDOVER_OPEN_TEXT)
    expect(
      resolveExternalAgentHandoverClientText(at("2026-10-23T20:00:00.000")),
    ).toBe(EXTERNAL_AGENT_HANDOVER_CLOSED_TEXT)
  })
})

describe("working window boundaries", () => {
  test.each([
    ["Mon 00:00:00.000 before opening", "2026-10-19T00:00:00.000", false],
    ["Mon 09:59:59.999 just before opening", "2026-10-19T09:59:59.999", false],
    ["Mon 10:00:00.000 exactly at opening", "2026-10-19T10:00:00.000", true],
    ["Mon 10:00:00.001 just after opening", "2026-10-19T10:00:00.001", true],
    ["Wed 14:30:00.000 mid-window", "2026-10-21T14:30:00.000", true],
    ["Fri 18:59:59.999 just before closing", "2026-10-23T18:59:59.999", true],
    ["Fri 19:00:00.000 exactly at closing", "2026-10-23T19:00:00.000", false],
    ["Fri 19:00:00.001 just after closing", "2026-10-23T19:00:00.001", false],
    ["Fri 23:59:59.999 late evening", "2026-10-23T23:59:59.999", false],
    ["Sat 00:00:00.000 right after midnight", "2026-10-24T00:00:00.000", false],
    [
      "Sat 11:59:59.999 before Saturday opening",
      "2026-10-24T11:59:59.999",
      false,
    ],
    [
      "Sat 12:00:00.000 exactly at Saturday opening",
      "2026-10-24T12:00:00.000",
      true,
    ],
    [
      "Sat 15:59:59.999 just before Saturday closing",
      "2026-10-24T15:59:59.999",
      true,
    ],
    [
      "Sat 16:00:00.000 exactly at Saturday closing",
      "2026-10-24T16:00:00.000",
      false,
    ],
    [
      "Sun 12:00:00.000 at the would-be window",
      "2026-10-25T12:00:00.000",
      false,
    ],
    ["Sun 15:00:00.000 afternoon", "2026-10-25T15:00:00.000", false],
    [
      "Mon 10:00:00.000 weekday window resumes",
      "2026-10-26T10:00:00.000",
      true,
    ],
  ])("%s is open=%s", (_label, msk, open) => {
    expect(isExternalAgentHandoverWindowOpen(at(msk))).toBe(open)
  })
})

describe("working window matches an independent Moscow clock", () => {
  const WEEKDAY_BY_SHORT: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }

  const mskWallClock = (
    date: Date,
  ): { weekday: number; hour: number; minute: number } => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Moscow",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(date)
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? ""
    return {
      weekday: WEEKDAY_BY_SHORT[get("weekday")] ?? -1,
      hour: Number(get("hour")),
      minute: Number(get("minute")),
    }
  }

  /** The oracle reads the wall clock via Intl/ICU, never via the code under test. */
  const oracleOpen = (date: Date): boolean => {
    const { weekday, hour } = mskWallClock(date)
    if (weekday === 0) {
      return false
    }
    const [openHour, closeHour] = weekday === 6 ? [12, 16] : [10, 19]
    return hour >= openHour && hour < closeHour
  }

  test("every minute of a full week agrees with the Moscow wall clock", () => {
    // Mon 2026-10-19 00:00:00 MSK → Mon 2026-10-26 00:00:00 MSK.
    const start = Date.parse("2026-10-18T21:00:00.000Z")
    const end = Date.parse("2026-10-25T21:00:00.000Z")
    for (let ms = start; ms <= end; ms += 60_000) {
      const instant = new Date(ms)
      expect(
        isExternalAgentHandoverWindowOpen(instant),
        `instant ${new Date(ms).toISOString()} (MSK ${new Intl.DateTimeFormat(
          "en-GB",
          {
            timeZone: "Europe/Moscow",
            dateStyle: "short",
            timeStyle: "medium",
          },
        ).format(instant)})`,
      ).toBe(oracleOpen(instant))
    }
  })

  test("the window does not depend on seconds within the same minute", () => {
    // 18:59:59.999 MSK Friday is still open; 19:00:00.000 is not.
    expect(
      isExternalAgentHandoverWindowOpen(at("2026-10-23T18:59:59.999")),
    ).toBe(true)
    expect(
      isExternalAgentHandoverWindowOpen(at("2026-10-23T19:00:00.000")),
    ).toBe(false)
  })
})
