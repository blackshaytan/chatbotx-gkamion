import { describe, expect, it } from "vitest"
import { detectOptOutRequest } from "../../src/voice-agent/opt-out-detection"

describe("detectOptOutRequest", () => {
  it.each([
    "Больше не звоните мне",
    "не звоните мне больше",
    "Не звоните мне, пожалуйста",
    "хватит мне звонить",
    "уберите мой номер из обзвона",
    "Не хочу чтобы мне звонили",
    "не звоните мне больше никогда",
    "не звоните больше",
    "не звони больше",
  ])("ловит %s", (text) => {
    expect(detectOptOutRequest(text).matched).toBe(true)
  })

  it.each([
    "курьер не звонит",
    "курьер не звонит мне",
    "он больше не звонит",
    "мне никто не звонил",
    "не звоните, я сам приеду",
    "перезвоните мне",
    "почему вы не звоните мне",
    "не звоните",
    "",
    "спасибо, всё получил",
  ])("пропускает %s", (text) => {
    expect(detectOptOutRequest(text)).toEqual({ matched: false })
  })

  it("нормализует ё и пунктуацию", () => {
    expect(detectOptOutRequest("Хватит  звонить!!!").matched).toBe(true)
  })
})
