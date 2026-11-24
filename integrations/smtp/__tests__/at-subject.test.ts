import { describe, expect, test } from "vitest"
import { parseSmtpAtSubject } from "../src/thread"

describe("parseSmtpAtSubject", () => {
  test("leaves ordinary text unchanged", () => {
    expect(parseSmtpAtSubject("Привет!")).toEqual({ body: "Привет!" })
  })

  test("reads a one-word subject and the rest of the line as the body", () => {
    expect(parseSmtpAtSubject("@тема Текст письма")).toEqual({
      subject: "тема",
      body: "Текст письма",
    })
  })

  test("reads a multi-word subject before a colon on one line", () => {
    expect(parseSmtpAtSubject("@Вопрос по заказу 25188: Здравствуйте")).toEqual(
      {
        subject: "Вопрос по заказу 25188",
        body: "Здравствуйте",
      },
    )
  })

  test("reads the first line after @ as the subject when there is a newline", () => {
    expect(
      parseSmtpAtSubject(
        "@Вопрос по заказу 25188\nЗдравствуйте,\nнужна помощь",
      ),
    ).toEqual({
      subject: "Вопрос по заказу 25188",
      body: "Здравствуйте,\nнужна помощь",
    })
  })

  test("ignores a leading @ with no subject text", () => {
    expect(parseSmtpAtSubject("@\nтело")).toEqual({ body: "@\nтело" })
  })
})
