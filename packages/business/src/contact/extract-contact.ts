import {
  type CountryCode,
  isSupportedCountry,
  type NumberFormat,
  type PhoneNumber,
  parsePhoneNumberFromString,
} from "libphonenumber-js"

/**
 * Global so `matchAll` can see every address in a body, not only the first.
 * The lookbehind only lets a match start at the beginning of a local-part run,
 * so a long run of local-part characters without an `@` is rejected in a single
 * pass instead of being re-scanned from every interior position.
 */
const EMAIL_REGEX_GLOBAL =
  /(?<![a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

/**
 * Region fallback list when no `defaultCountry` is supplied. Narrower than the
 * PHP `hasPhoneNumber` original (`['VN','PH','KH','ID','US','TH']`) to avoid
 * false positives from overlapping numbering plans.
 */
const FALLBACK_REGIONS: CountryCode[] = ["VN", "US"]

/** Minimum digit count for `parsePhoneNumber` to even attempt. Matches PHP. */
const MIN_DIGITS = 8

/** Digit-run matcher — at least 8 digits, optionally interleaved with separators. */
const DIGIT_RUN_RE = /(?:[-_.+()\s]*\d){8,}/gm

/** Strip noise chars (mirrors PHP `strtr` table). */
const STRIP_CHARS_RE = /[-.,_\s()\t\n\r]/g

/** Collapse runs of `+` into a single `+`. */
const MULTI_PLUS_RE = /\++/g

/** VN-only: when match length ≥10, prefer the first run of 10 digits followed by a non-digit. */
const VN_TEN_DIGIT_RE = /(\d{10})\D/m

/** Loose common-format phone regex used as a fallback when the strict run scan misses. */
const COMMON_PHONE_RE =
  /[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}\b/gim

/** URLs carry numeric ids (storage paths, tracking tokens) that look like phones. */
const URL_RE = /https?:\/\/\S+/gi

/** `DD.MM.YYYY` (also `/` or `-`) dates — digits that are never a phone number. */
const DATE_DMY_RE = /(?<!\d)\d{1,2}[./-]\d{1,2}[./-]\d{4}(?!\d)/g

/** `YYYY-YYYY` year ranges such as `1998-2005`. */
const YEAR_RANGE_RE = /(?<!\d)(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}(?!\d)/g

/** A letter, `_` or `#` directly before a digit run means it belongs to an identifier (`ORDER_12345678`, `#12345678`). */
const PRECEDING_IDENTIFIER_CHAR_RE = /[A-Za-zА-Яа-яЁё_#]/

/** A letter or `_` directly after a digit run means it belongs to an identifier (`602002394AA`, `12345678_x`). */
const FOLLOWING_IDENTIFIER_CHAR_RE = /[A-Za-zА-Яа-яЁё_]/

/** Separator that can open a digit-run match (`id-12345678`, `No.12345678`). */
const LEADING_SEPARATOR_RE = /[-._]/

/** Word or digit character that makes a leading separator part of an identifier. */
const WORD_OR_DIGIT_RE = /[A-Za-zА-Яа-яЁё0-9]/

const DIGIT_CHAR_RE = /\d/

const LINE_BREAK_RE = /\r?\n/

/** Subject header that can lead an email body (`Subject: Re: Заказ 12345678`). */
const SUBJECT_LINE_RE = /^subject:\s*.*$/i

/** Lines that open a forwarded / original message block. Everything after is history. */
const FORWARD_DELIMITER_RES: readonly RegExp[] = [
  /^-{2,}\s*(original message|forwarded message|исходное сообщение|пересылаемое сообщение)\s*-{2,}$/i,
  /^begin forwarded message:\s*$/i,
]

/** Attribution lines that introduce a quoted reply: `On ... wrote:`, `... писал(а):`, `... пишет:`. */
const QUOTE_ATTRIBUTION_RES: readonly RegExp[] = [
  /^on\s+.+\s+wrote:$/i,
  /(?:писал(?:\(?[ао]\)?)?|пишет)\s*:$/i,
]

/** A `<email@domain>` header ending with `:`, e.g. `вт, 24 нояб. 2026 г., Баринов <s.barinov@gkamion.ru>:`. */
const ANGLE_EMAIL_HEADER_RE = /<[^<>\s]+@[^<>\s]+>.*:$/

/** A date, weekday or number at the start of an attribution line. */
const ATTRIBUTION_DATE_START_RE =
  /^(?:\d|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|(?:пн|вт|ср|чт|пт|сб|вс)[а-яё]*)/i

/** Words that mark an angle-email header as a quote attribution. */
const ATTRIBUTION_VERB_RE = /wrote|писал|пишет/i

/** Outlook / standard header block: `From: …` followed within a few lines by a `Sent:` / `Date:` header. */
const OUTLOOK_FROM_RE = /^\s*(?:from|от):\s+.+$/i
const OUTLOOK_SENT_HEADER_RE = /^\s*(?:sent|date|дата|отправлено):\s+.+$/i
const OUTLOOK_HEADER_LOOKAHEAD_LINES = 3

const QUOTED_LINE_RE = /^>/

/** Minimum text length worth running through the extractor. */
const MIN_EXTRACT_TEXT_LENGTH = 5

export type ExtractedContactInfo = {
  /** E.164 format when libphonenumber recognises the number. */
  phoneNumber?: string
  /** Trimmed, lower-cased. */
  email?: string
}

/**
 * Per-field opt-out for callers that have already discovered one side of the
 * pair (e.g. Messenger coexist sync skips libphonenumber once a conversation's
 * phone is known — the two-stage scan dominates CPU per message).
 */
export type ExtractContactOptions = {
  skipPhone?: boolean
  skipEmail?: boolean
  /** Addresses that must never be picked as the contact's email (e.g. the workspace's own mailboxes). */
  excludeEmails?: ReadonlySet<string>
}

/** Parsed phone carrying the cleaned source string (for E.164 vs raw decision). */
export type ParsedPhone = {
  number: PhoneNumber
  phoneFromString: string
}

const cleanPhone = (raw: string): string =>
  raw.replace(STRIP_CHARS_RE, "").replace(MULTI_PLUS_RE, "+")

/**
 * True when the digits of a match are not glued to an identifier. Checks the
 * boundary of the first/last digit, so leading separators like ` +84` do not
 * count as a neighbouring character. A leading `-`, `.` or `_` that directly
 * follows a word or digit (`id-12345678`, `No.12345678`) also glues the run.
 */
const isStandaloneDigitRun = (
  text: string,
  matchStart: number,
  rawMatch: string,
): boolean => {
  const leadingWhitespaceLength = rawMatch.length - rawMatch.trimStart().length
  const trimmedStart = matchStart + leadingWhitespaceLength
  const firstDigitIndex = matchStart + rawMatch.search(DIGIT_CHAR_RE)
  const lastDigitEnd = matchStart + rawMatch.length
  const charBefore = text.charAt(firstDigitIndex - 1)
  const charAfter = text.charAt(lastDigitEnd)
  const isSeparatorGlued =
    LEADING_SEPARATOR_RE.test(text.charAt(trimmedStart)) &&
    WORD_OR_DIGIT_RE.test(text.charAt(trimmedStart - 1))
  return !(
    PRECEDING_IDENTIFIER_CHAR_RE.test(charBefore) ||
    FOLLOWING_IDENTIFIER_CHAR_RE.test(charAfter) ||
    isSeparatorGlued
  )
}

/**
 * Removes URLs, email addresses and non-phone date/year patterns before any
 * digit scan, so ids embedded in them are never read as phone numbers.
 */
const sanitizePhoneSource = (text: string): string =>
  text
    .replace(URL_RE, " ")
    .replace(EMAIL_REGEX_GLOBAL, " ")
    .replace(DATE_DMY_RE, " ")
    .replace(YEAR_RANGE_RE, " ")

/** PHP `getCommonPhoneNumber` — returns the LAST loose-format match (PHP `end()`). */
const getCommonPhoneNumber = (text: string): string | null => {
  const matches = [...text.matchAll(COMMON_PHONE_RE)].filter((match) =>
    isStandaloneDigitRun(text, match.index ?? 0, match[0]),
  )
  return matches.at(-1)?.[0] ?? null
}

const tryRegions = (
  text: string,
  regions: CountryCode[],
): ParsedPhone | null => {
  if (!text || text.length < MIN_DIGITS) {
    return null
  }

  for (const match of text.matchAll(DIGIT_RUN_RE)) {
    const rawMatch = match[0]
    if (!isStandaloneDigitRun(text, match.index ?? 0, rawMatch)) {
      continue
    }
    const cleaned = cleanPhone(rawMatch)
    for (const region of regions) {
      // VN special case: when the cleaned number is ≥10 chars, prefer the
      // first 10-digit window from the raw match so trailing junk doesn't poison parsing.
      let phone = cleaned
      if (region === "VN" && cleaned.length >= 10) {
        const vn = rawMatch.match(VN_TEN_DIGIT_RE)
        phone = vn?.[1] ?? cleaned
      }

      let parsed: PhoneNumber | undefined
      try {
        parsed = parsePhoneNumberFromString(phone, region)
      } catch {
        continue
      }
      if (!parsed) {
        continue
      }
      // PHP skips FIXED_LINE for any non-VN region to suppress
      // overlapping landline false positives.
      if (parsed.getType() === "FIXED_LINE" && region !== "VN") {
        continue
      }
      if (!parsed.isPossible()) {
        continue
      }
      if (!parsed.isValid()) {
        continue
      }
      return { number: parsed, phoneFromString: phone }
    }
  }
  return null
}

/**
 * A caller-supplied region wins exclusively; `FALLBACK_REGIONS` apply only when
 * no usable region is given. International `+` numbers still parse under any
 * supported region, so they are unaffected.
 */
const resolvePhoneRegions = (
  region?: CountryCode | CountryCode[] | string | null,
): CountryCode[] => {
  if (Array.isArray(region)) {
    return region as CountryCode[]
  }
  if (region && isSupportedCountry(region)) {
    return [region]
  }
  return FALLBACK_REGIONS
}

/**
 * Port of PHP `parsePhoneNumber` (chatbotai `app/Helpers/functions.php`).
 *
 * Two-stage: strict digit-run scan → loose `getCommonPhoneNumber` fallback.
 * Honors caller-supplied region(s); otherwise uses `FALLBACK_REGIONS`.
 */
export const parsePhoneNumber = (
  text: string | null | undefined,
  region?: CountryCode | CountryCode[] | string | null,
): ParsedPhone | null => {
  if (!text) {
    return null
  }
  const sanitized = sanitizePhoneSource(text)
  const regions = resolvePhoneRegions(region)

  const result = tryRegions(sanitized, regions)
  if (result) {
    return result
  }
  const common = getCommonPhoneNumber(sanitized)
  return common ? tryRegions(common, regions) : null
}

/**
 * Port of PHP `hasPhoneNumber`. Calls `parsePhoneNumber` first, then decides
 * format:
 *  - Explicit `format` arg wins.
 *  - Else: input starts with `+` OR with the country code → format as E.164.
 *  - Else: return raw cleaned input (PHP behavior preserved).
 */
export const hasPhoneNumber = (
  text: string | null | undefined,
  region?: CountryCode | CountryCode[] | string | null,
  format: NumberFormat | null = null,
): string | null => {
  if (!text) {
    return null
  }
  const parsed = parsePhoneNumber(text, region)
  if (!parsed) {
    return null
  }
  if (format) {
    return parsed.number.format(format)
  }
  const cc = String(parsed.number.countryCallingCode)
  if (
    parsed.phoneFromString.startsWith("+") ||
    parsed.phoneFromString.startsWith(cc)
  ) {
    return parsed.number.format("E.164")
  }
  return parsed.phoneFromString
}

/** Every email address in `text`, lower-cased and trimmed, in order of appearance. */
export const extractEmailAddresses = (text: string): string[] =>
  [...text.matchAll(EMAIL_REGEX_GLOBAL)].map(([match]) =>
    match.trim().toLowerCase(),
  )

const isForwardDelimiter = (trimmedLine: string): boolean =>
  FORWARD_DELIMITER_RES.some((delimiterRe) => delimiterRe.test(trimmedLine))

/** Trimmed text of up to `count` non-blank lines that follow `index`. */
const findNextContentLines = (
  lines: readonly string[],
  index: number,
  count: number,
): string[] => {
  const found: string[] = []
  for (
    let next = index + 1;
    next < lines.length && found.length < count;
    next++
  ) {
    const trimmed = (lines[next] ?? "").trim()
    if (trimmed !== "") {
      found.push(trimmed)
    }
  }
  return found
}

/** Trimmed text of the first non-blank line after `index`, or `""` when none. */
const findNextContentLine = (lines: readonly string[], index: number): string =>
  findNextContentLines(lines, index, 1)[0] ?? ""

/**
 * `<email>:` headers are only treated as a quote attribution when they look
 * like one, so a sender writing `Email me at <jane@acme.com>:` keeps their text.
 */
const isAngleEmailAttributionLine = (
  lines: readonly string[],
  index: number,
  trimmedLine: string,
): boolean => {
  if (!ANGLE_EMAIL_HEADER_RE.test(trimmedLine)) {
    return false
  }
  return (
    ATTRIBUTION_DATE_START_RE.test(trimmedLine) ||
    ATTRIBUTION_VERB_RE.test(trimmedLine) ||
    QUOTED_LINE_RE.test(findNextContentLine(lines, index))
  )
}

const isQuoteAttributionLine = (
  lines: readonly string[],
  index: number,
  trimmedLine: string,
): boolean =>
  QUOTE_ATTRIBUTION_RES.some((attributionRe) =>
    attributionRe.test(trimmedLine),
  ) || isAngleEmailAttributionLine(lines, index, trimmedLine)

/**
 * A `From:` line followed within a few non-blank lines by a `Sent:` / `Date:`
 * header. `From:` + `To:` alone is ordinary text and is not treated as a block.
 */
const isOutlookHeaderBlock = (
  lines: readonly string[],
  index: number,
  trimmedLine: string,
): boolean => {
  if (!OUTLOOK_FROM_RE.test(trimmedLine)) {
    return false
  }
  return findNextContentLines(
    lines,
    index,
    OUTLOOK_HEADER_LOOKAHEAD_LINES,
  ).some((line) => OUTLOOK_SENT_HEADER_RE.test(line))
}

/**
 * An attribution header wrapped across two physical lines, e.g.
 * `вт, 24 нояб. 2026 г. в 16:34,` + `Баринов <s.barinov@gkamion.ru>:`. The two
 * lines are joined and checked as one header.
 */
const isWrappedQuoteAttribution = (
  lines: readonly string[],
  index: number,
  trimmedLine: string,
): boolean => {
  if (index + 1 >= lines.length) {
    return false
  }
  const nextTrimmedLine = (lines[index + 1] ?? "").trim()
  const twoLine = `${trimmedLine} ${nextTrimmedLine}`
    .replace(/<\s+/g, "<")
    .replace(/\s+>/g, ">")
    .trim()
  return isQuoteAttributionLine(lines, index + 1, twoLine)
}

/**
 * Keeps only the sender's new text from an email body. Drops a leading
 * `Subject:` line and `>`-quoted lines, and stops at the first forwarded
 * delimiter, quote attribution line or Outlook header block so the thread
 * history below it is never scanned for contact info.
 */
export const stripQuotedEmailReply = (text: string): string => {
  const lines = text.split(LINE_BREAK_RE)
  const firstContentIndex = lines.findIndex((line) => line.trim() !== "")
  const keptLines: string[] = []

  for (const [index, line] of lines.entries()) {
    const trimmedLine = line.trim()
    if (index === firstContentIndex && SUBJECT_LINE_RE.test(trimmedLine)) {
      continue
    }
    if (
      isForwardDelimiter(trimmedLine) ||
      isQuoteAttributionLine(lines, index, trimmedLine) ||
      isWrappedQuoteAttribution(lines, index, trimmedLine) ||
      isOutlookHeaderBlock(lines, index, trimmedLine)
    ) {
      break
    }
    if (!QUOTED_LINE_RE.test(trimmedLine)) {
      keptLines.push(line)
    }
  }
  return keptLines.join("\n").trim()
}

/**
 * Pure extractor — scans free text for phone + email. Used by Messenger
 * coexist historical sync and the live webhook to enrich Contact rows when
 * the customer typed their phone/email into a message body.
 *
 * Phone resolution: PHP `hasPhoneNumber` port forced to E.164.
 * Email: first address not in `excludeEmails`, lower-cased + trimmed.
 */
export const extractContactInfo = (
  text: string | null | undefined,
  defaultCountry?: string | null,
  options?: ExtractContactOptions,
): ExtractedContactInfo => {
  if (!text || text.length < MIN_EXTRACT_TEXT_LENGTH) {
    return {}
  }

  const result: ExtractedContactInfo = {}

  if (!options?.skipEmail) {
    const email = extractEmailAddresses(text).find(
      (candidate) => !options?.excludeEmails?.has(candidate),
    )
    if (email) {
      result.email = email
    }
  }

  if (!options?.skipPhone) {
    const phone = hasPhoneNumber(text, defaultCountry ?? null, "E.164")
    if (phone) {
      result.phoneNumber = phone
    }
  }

  return result
}
