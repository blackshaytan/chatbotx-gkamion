import { describe, expect, test } from "vitest"
import {
  extractContactInfo,
  hasPhoneNumber,
  parsePhoneNumber,
  stripQuotedEmailReply,
} from "../src/contact/extract-contact"

describe("extractContactInfo", () => {
  test("returns empty object for empty/short input", () => {
    expect(extractContactInfo("")).toEqual({})
    expect(extractContactInfo(null)).toEqual({})
    expect(extractContactInfo(undefined)).toEqual({})
    expect(extractContactInfo("abc")).toEqual({})
  })

  test("returns empty object when no contact info present", () => {
    expect(extractContactInfo("hello there how are you")).toEqual({})
  })

  test("extracts VN local-format phone with VN defaultCountry", () => {
    expect(extractContactInfo("Call me 0912345678", "VN")).toEqual({
      phoneNumber: "+84912345678",
    })
  })

  test("extracts email (lowercased + trimmed)", () => {
    expect(extractContactInfo("My email is Jane@Acme.COM")).toEqual({
      email: "jane@acme.com",
    })
  })

  test("extracts both phone and email", () => {
    const result = extractContactInfo("+1 415 555 0199 or alex@x.io")
    expect(result.email).toBe("alex@x.io")
    expect(result.phoneNumber).toBe("+14155550199")
  })

  test("rejects too-short numeric runs", () => {
    expect(extractContactInfo("My number 12345", "VN")).toEqual({})
  })

  test("extracts E.164 phone without defaultCountry", () => {
    expect(extractContactInfo("contact +84 90 1234 567")).toEqual({
      phoneNumber: "+84901234567",
    })
  })

  test("falls back to VN region when no defaultCountry", () => {
    expect(extractContactInfo("call 0912345678")).toEqual({
      phoneNumber: "+84912345678",
    })
  })

  test("falls back to US region when no defaultCountry", () => {
    expect(extractContactInfo("call 415-555-0199")).toEqual({
      phoneNumber: "+14155550199",
    })
  })

  test("does not extract Thai local format (TH not in fallback)", () => {
    expect(extractContactInfo("02 123 4567")).toEqual({})
  })

  test("ignores invalid region gracefully", () => {
    // Invalid CountryCode should not crash; falls through to fallback list.
    expect(extractContactInfo("call 415-555-0199", "ZZ")).toEqual({
      phoneNumber: "+14155550199",
    })
  })

  test("treats null defaultCountry same as undefined", () => {
    expect(extractContactInfo("call 0912345678", null)).toEqual({
      phoneNumber: "+84912345678",
    })
  })
})

describe("parsePhoneNumber (PHP port)", () => {
  test("returns null on empty / too-short input", () => {
    expect(parsePhoneNumber("")).toBeNull()
    expect(parsePhoneNumber(null)).toBeNull()
    expect(parsePhoneNumber("12345")).toBeNull()
  })

  test("parses VN local 10-digit mobile and preserves cleaned source", () => {
    const result = parsePhoneNumber("call me 0912345678 plz", "VN")
    expect(result).not.toBeNull()
    expect(result?.number.format("E.164")).toBe("+84912345678")
    expect(result?.phoneFromString).toBe("0912345678")
  })

  test("falls back to loose getCommonPhoneNumber on missed strict scan", () => {
    // 415-555-0199 has separators, the strict scan still catches it under US.
    const result = parsePhoneNumber("ring 415-555-0199 today")
    expect(result?.number.format("E.164")).toBe("+14155550199")
  })

  test("accepts region as array", () => {
    const result = parsePhoneNumber("0912345678", ["US", "VN"])
    expect(result?.number.format("E.164")).toBe("+84912345678")
  })
})

describe("hasPhoneNumber (PHP port)", () => {
  test("returns E.164 when source starts with +", () => {
    expect(hasPhoneNumber("contact +84 90 1234 567")).toBe("+84901234567")
  })

  test("returns E.164 when source starts with country code", () => {
    // "84912345678" — starts with VN country code "84".
    expect(hasPhoneNumber("ping 84912345678 thanks", "VN")).toBe("+84912345678")
  })

  test("returns raw cleaned source when local format with no + and no CC prefix", () => {
    // "0912345678" — local VN format, no + and does not start with "84".
    expect(hasPhoneNumber("ring 0912345678 ok", "VN")).toBe("0912345678")
  })

  test("explicit format arg wins (NATIONAL)", () => {
    expect(hasPhoneNumber("0912345678", "VN", "NATIONAL")).toBe("0912 345 678")
  })

  test("returns null on empty / unparseable input", () => {
    expect(hasPhoneNumber("")).toBeNull()
    expect(hasPhoneNumber("hello world no phone")).toBeNull()
  })
})

describe("extractContactInfo — VN carrier prefixes", () => {
  // Viettel
  test("Viettel 096 prefix", () => {
    expect(extractContactInfo("liên hệ 0961234567", "VN").phoneNumber).toBe(
      "+84961234567",
    )
  })
  // Vinaphone
  test("Vinaphone 091 prefix", () => {
    expect(extractContactInfo("alo 0912345678", "VN").phoneNumber).toBe(
      "+84912345678",
    )
  })
  // Mobifone
  test("Mobifone 089 prefix", () => {
    expect(extractContactInfo("gọi 0898765432", "VN").phoneNumber).toBe(
      "+84898765432",
    )
  })
  // Newer 03x prefix (post-2018 reassignment)
  test("VN new 03x mobile prefix", () => {
    expect(extractContactInfo("sđt 0367123456", "VN").phoneNumber).toBe(
      "+84367123456",
    )
  })
  // 07x prefix
  test("VN 07x mobile prefix", () => {
    expect(extractContactInfo("phone 0789123456", "VN").phoneNumber).toBe(
      "+84789123456",
    )
  })
  // 05x prefix (Vietnamobile/Reddi)
  test("VN 05x mobile prefix", () => {
    expect(extractContactInfo("sđt 0521234567", "VN").phoneNumber).toBe(
      "+84521234567",
    )
  })
})

describe("extractContactInfo — VN international formats", () => {
  test("E.164 with +84 + spaces", () => {
    expect(extractContactInfo("ring +84 912 345 678").phoneNumber).toBe(
      "+84912345678",
    )
  })

  test("E.164 with +84 + dots", () => {
    expect(extractContactInfo("call +84.912.345.678").phoneNumber).toBe(
      "+84912345678",
    )
  })

  test("E.164 with +84 + dashes", () => {
    expect(extractContactInfo("phone +84-912-345-678").phoneNumber).toBe(
      "+84912345678",
    )
  })

  test("00-prefix international (00 → +)", () => {
    expect(extractContactInfo("intl 0084912345678", "VN").phoneNumber).toBe(
      "+84912345678",
    )
  })
})

describe("extractContactInfo — US formats", () => {
  test("parens + dash US", () => {
    expect(extractContactInfo("call (415) 555-0199").phoneNumber).toBe(
      "+14155550199",
    )
  })

  test("dot-separated US", () => {
    expect(extractContactInfo("ring 415.555.0199").phoneNumber).toBe(
      "+14155550199",
    )
  })

  test("dash-separated US with +1", () => {
    expect(extractContactInfo("call +1-415-555-0199").phoneNumber).toBe(
      "+14155550199",
    )
  })

  test("US toll-free 800", () => {
    expect(extractContactInfo("hotline 1-800-555-0199", "US").phoneNumber).toBe(
      "+18005550199",
    )
  })
})

describe("extractContactInfo — noisy / embedded text", () => {
  test("phone embedded in Vietnamese sentence", () => {
    expect(
      extractContactInfo(
        "Chào anh, anh có thể gọi cho em số 0912345678 nhé, cảm ơn.",
        "VN",
      ).phoneNumber,
    ).toBe("+84912345678")
  })

  test("phone with surrounding punctuation", () => {
    expect(extractContactInfo("[contact: 0912345678!]", "VN").phoneNumber).toBe(
      "+84912345678",
    )
  })

  test("phone after currency / numeric noise", () => {
    expect(
      extractContactInfo("price $99 then call 0912345678", "VN").phoneNumber,
    ).toBe("+84912345678")
  })

  test("phone embedded between words on one line", () => {
    expect(
      extractContactInfo("hotline:0912345678 thanks", "VN").phoneNumber,
    ).toBe("+84912345678")
  })
})

describe("extractContactInfo — multi-number text (first valid wins)", () => {
  test("two VN mobiles → first match wins", () => {
    expect(
      extractContactInfo("primary 0912345678 backup 0987654321", "VN")
        .phoneNumber,
    ).toBe("+84912345678")
  })

  test("invalid-then-valid → returns valid one", () => {
    // 7-digit run gets skipped by MIN_DIGITS=8; loose fallback may catch it
    // but the strict-pass second-run wins first.
    const out = extractContactInfo("ref 1234567 phone 0912345678", "VN")
    expect(out.phoneNumber).toBe("+84912345678")
  })
})

describe("extractContactInfo — negative / robustness", () => {
  test("only digits but too short", () => {
    expect(extractContactInfo("code 1234567", "VN").phoneNumber).toBeUndefined()
  })

  test("pure prose returns nothing", () => {
    expect(
      extractContactInfo("hello how are you today", "VN").phoneNumber,
    ).toBeUndefined()
  })

  test("ID-card-like 12 digits with country defaultCountry still tolerated", () => {
    // 12-digit IDs CAN look like a phone. Document current behavior:
    // VN treats this as a possible-but-invalid landline → rejected.
    expect(
      extractContactInfo("CMND 012345678901", "VN").phoneNumber,
    ).toBeUndefined()
  })

  test("international + prefix wins over region (UK landline accepted)", () => {
    // `+44 ...` is parsed using `+44` regardless of the region hint. The
    // FIXED_LINE-skip rule only fires when `region !== "VN"`; since VN is the
    // first region tried, the UK landline slips through. Documented behavior —
    // PHP exhibits the same.
    expect(extractContactInfo("UK +44 20 7946 0958").phoneNumber).toBe(
      "+442079460958",
    )
  })

  test("garbage with separators only", () => {
    expect(
      extractContactInfo("--- ... +++ () ___", "VN").phoneNumber,
    ).toBeUndefined()
  })
})

describe("extractContactInfo — combined phone + email", () => {
  test("phone before email", () => {
    expect(
      extractContactInfo("hi 0912345678 mail jane@acme.com", "VN"),
    ).toEqual({
      phoneNumber: "+84912345678",
      email: "jane@acme.com",
    })
  })

  test("email before phone", () => {
    expect(
      extractContactInfo("email jane@acme.com phone +84 912 345 678"),
    ).toEqual({
      phoneNumber: "+84912345678",
      email: "jane@acme.com",
    })
  })

  test("phone on one line, email on next", () => {
    expect(extractContactInfo("0912345678\njane@acme.com", "VN")).toEqual({
      phoneNumber: "+84912345678",
      email: "jane@acme.com",
    })
  })
})

describe("extractContactInfo — skip flags", () => {
  test("skipPhone skips phone extraction, email still returned", () => {
    expect(
      extractContactInfo("call 0912345678 mail jane@acme.com", "VN", {
        skipPhone: true,
      }),
    ).toEqual({ email: "jane@acme.com" })
  })

  test("skipEmail skips email extraction, phone still returned", () => {
    expect(
      extractContactInfo("call 0912345678 mail jane@acme.com", "VN", {
        skipEmail: true,
      }),
    ).toEqual({ phoneNumber: "+84912345678" })
  })

  test("both skip flags returns empty object", () => {
    expect(
      extractContactInfo("call 0912345678 mail jane@acme.com", "VN", {
        skipPhone: true,
        skipEmail: true,
      }),
    ).toEqual({})
  })

  test("undefined options preserves default 2-arg behavior", () => {
    expect(
      extractContactInfo("call 0912345678 mail jane@acme.com", "VN"),
    ).toEqual({ phoneNumber: "+84912345678", email: "jane@acme.com" })
  })

  test("empty options object behaves like no options", () => {
    expect(
      extractContactInfo("call 0912345678 mail jane@acme.com", "VN", {}),
    ).toEqual({ phoneNumber: "+84912345678", email: "jane@acme.com" })
  })
})

describe("extractContactInfo — region preference", () => {
  test("valid supported defaultCountry does not fall back to VN/US for local-format numbers", () => {
    // Valid supported region (PH, RU) restricts parsing to that region only;
    // local-format digit runs that are invalid in that region do not fall back to VN/US.
    expect(
      extractContactInfo("call 0912345678", "PH").phoneNumber,
    ).toBeUndefined()
    expect(
      extractContactInfo("call 0912345678", "RU").phoneNumber,
    ).toBeUndefined()
  })

  test("international + prefix resolves even under non-matching defaultCountry", () => {
    // "+1 ..." is unambiguously international — resolves under VN or RU.
    expect(extractContactInfo("US +1 415 555 0199", "VN").phoneNumber).toBe(
      "+14155550199",
    )
    expect(extractContactInfo("US +1 415 555 0199", "RU").phoneNumber).toBe(
      "+14155550199",
    )
  })
})

describe("extractContactInfo — false-positive rejection", () => {
  test("Russian part number with following letters (арт. 602002394AA)", () => {
    expect(extractContactInfo("арт. 602002394AA", "RU")).toEqual({})
  })

  test("DMY dates (13.11.2026, 19.11.2026)", () => {
    expect(extractContactInfo("доставка 13.11.2026", "RU")).toEqual({})
    expect(extractContactInfo("дата 19.11.2026", "RU")).toEqual({})
  })

  test("year ranges (1998-2005)", () => {
    expect(extractContactInfo("модель 1998-2005 годов", "RU")).toEqual({})
  })

  test("storage and conversation URLs with numeric IDs", () => {
    expect(
      extractContactInfo(
        "https://chatbotx.gkamion.ru/storage/public/space/11744657350097881/conversations/11795165016611902/11795393671026719",
        "RU",
      ),
    ).toEqual({})
  })

  test("identifiers with glued prefixes or separators (id-12345678, invoice No.12345678, ORDER_12345678, #12345678)", () => {
    expect(extractContactInfo("id-12345678", "RU")).toEqual({})
    expect(extractContactInfo("invoice No.12345678", "RU")).toEqual({})
    expect(extractContactInfo("ORDER_12345678", "RU")).toEqual({})
    expect(extractContactInfo("#12345678", "RU")).toEqual({})
  })

  test("email with numeric local part (order.12345678@shop.com) extracts email only, not phone", () => {
    expect(extractContactInfo("order.12345678@shop.com", "RU")).toEqual({
      email: "order.12345678@shop.com",
    })
  })
})

describe("extractContactInfo — Russian phone numbers under RU", () => {
  test("valid +7 E.164 format (+7 967 197-60-80)", () => {
    expect(extractContactInfo("+7 967 197-60-80", "RU")).toEqual({
      phoneNumber: "+79671976080",
    })
  })

  test("valid national 8-prefix format (8 (967) 197-60-80)", () => {
    expect(extractContactInfo("8 (967) 197-60-80", "RU")).toEqual({
      phoneNumber: "+79671976080",
    })
  })
})

describe("extractContactInfo — excludeEmails", () => {
  test("skips excluded own-workspace email and picks second email if present", () => {
    const result = extractContactInfo(
      "from sales@gkamion.ru to client@example.com",
      "RU",
      {
        excludeEmails: new Set(["sales@gkamion.ru"]),
      },
    )
    expect(result).toEqual({ email: "client@example.com" })
  })

  test("returns undefined email if only excluded email exists (case-insensitive)", () => {
    const result = extractContactInfo(
      "contact Sales@GKamion.RU for inquiries",
      "RU",
      {
        excludeEmails: new Set(["sales@gkamion.ru"]),
      },
    )
    expect(result.email).toBeUndefined()
  })
})

describe("stripQuotedEmailReply", () => {
  test("strips Russian Gmail reply with Subject, attribution, and quoted block", () => {
    const raw =
      "Subject: Re: возврат детали такой-то\n\nВсе получил, спасибо!\n\nвт, 24 нояб. 2026 г. в 16:34, Баринов Станислав <s.barinov@gkamion.ru>:\n\n> Здравствуйте отказ клиента арт. 602002394AA 5 штук"
    const stripped = stripQuotedEmailReply(raw)
    expect(stripped).toBe("Все получил, спасибо!")
    expect(extractContactInfo(stripped, "RU")).toEqual({})
  })

  test("stops at English quote attribution line before >-free quoted history", () => {
    const raw =
      "Thanks for the update!\n\nOn Tue, Nov 24, 2026 at 4:34 PM Jane <jane@acme.com> wrote:\nPlease call +1 415 555 0199"
    const stripped = stripQuotedEmailReply(raw)
    expect(stripped).toBe("Thanks for the update!")
    expect(extractContactInfo(stripped, "US")).toEqual({})
  })

  test("stops before quoted history on 2-line wrapped Gmail attribution", () => {
    const rawWrappedVerb =
      "Got it\n\nOn Tue, Nov 24, 2026 at 4:34 PM Jane <jane@acme.com>\nwrote:\nQuoted history with phone +1 415 555 0199"
    expect(stripQuotedEmailReply(rawWrappedVerb)).toBe("Got it")

    const rawWrappedEmail =
      "Got it\n\nOn Tue, Nov 24, 2026 at 4:34 PM Jane <\njane@acme.com> wrote:\nQuoted history with phone +1 415 555 0199"
    expect(stripQuotedEmailReply(rawWrappedEmail)).toBe("Got it")
  })

  test("stops at Outlook From: line when followed by Sent:/Date: block", () => {
    const raw =
      "Approved.\n\nFrom: Alice <alice@example.com>\nSent: Wednesday, Nov 25, 2026 10:00 AM\nTo: Bob <bob@example.com>\nSubject: Contract\n\nCall 0912345678"
    expect(stripQuotedEmailReply(raw)).toBe("Approved.")
  })

  test("preserves ordinary body text with From: and To: without Sent:/Date:", () => {
    const raw = "From: Ha Noi\nTo: Da Nang\n0912345678"
    const stripped = stripQuotedEmailReply(raw)
    expect(stripped).toBe("From: Ha Noi\nTo: Da Nang\n0912345678")
    expect(extractContactInfo(stripped, "VN").phoneNumber).toBe("+84912345678")
  })

  test("strips leading Subject: line so numbers in subject do not false-positive", () => {
    const raw = "Subject: Re: Заказ 12345678\n\nСпасибо"
    const stripped = stripQuotedEmailReply(raw)
    expect(stripped).toBe("Спасибо")
    expect(extractContactInfo(stripped, "RU")).toEqual({})
  })
})
