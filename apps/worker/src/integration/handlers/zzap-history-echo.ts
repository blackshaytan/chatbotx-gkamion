/**
 * ZZAP's message list does not return the text we posted. It replaces "₽"
 * and emoji with "?", and drops blank lines. The poll then hashes that
 * altered text, so the echo's sourceId never matches the row ChatbotX stored
 * at send time.
 *
 * A signed send adds another mismatch. The inbox row keeps the original text,
 * while the channel copy — and therefore the echo — starts with `Name: `.
 * ZZAP may also turn a symbol in front of that name into "?", so the echo
 * reads `?? Гека: …` against a stored `…`.
 *
 * "‼️" is two code points (‼ plus a variation selector). ZZAP keeps an
 * exclamation mark for the first and "?" for the selector, so the echo
 * reads "!?" where the inbox still has the emoji.
 *
 * Emoji outside the basic plane (😊, 📝) are one code point but two UTF-16
 * units. ZZAP replaces each unit, so one emoji comes back as "??".
 */
export const zzapHistoryEchoText = (text: string | null | undefined): string =>
  (text ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll("₽", "?")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")

/**
 * One leading `Name: ` label. The optional symbol run is ZZAP's "?"
 * stand-in for an emoji or other character it would not store. The colon
 * must be followed by whitespace, so a time such as `11:58` is left intact.
 */
const SENDER_SIGNATURE =
  /^(?:[^\p{L}\p{N}\n:]{0,12})?\p{L}[\p{L}\p{N} .'_-]{0,80}:\s+/u

const withoutSenderSignature = (text: string): string =>
  text.replace(SENDER_SIGNATURE, "")

const isVariationSelector = (char: string): boolean =>
  char === "\uFE0F" || char === "\uFE0E" || char === "\u200D"

const PICTOGRAPH = /\p{Extended_Pictographic}/u

const isPictograph = (char: string): boolean => PICTOGRAPH.test(char)

const isSupplementary = (char: string): boolean =>
  (char.codePointAt(0) ?? 0) > 0xff_ff

/**
 * Walk both copies together. Letters stay exact. A pictograph in the stored
 * text may be the "?" ZZAP wrote instead, and "‼" may also come back as "!".
 * A following variation selector may be its own "?" or may be gone. A
 * supplementary pictograph may also take a second "?", one per UTF-16 unit.
 */
const sameAfterZzapSymbolLoss = (stored: string, echoed: string): boolean => {
  const left = Array.from(stored)
  const right = Array.from(echoed)
  const matches = (fromStored: number, fromEchoed: number): boolean => {
    let storedIndex = fromStored
    let echoedIndex = fromEchoed
    while (storedIndex < left.length && echoedIndex < right.length) {
      const storedChar = left[storedIndex] ?? ""
      const echoedChar = right[echoedIndex] ?? ""
      if (storedChar === echoedChar) {
        storedIndex += 1
        echoedIndex += 1
        continue
      }
      if (
        storedChar === "\u203C" &&
        (echoedChar === "!" || echoedChar === "?")
      ) {
        storedIndex += 1
        echoedIndex += 1
        continue
      }
      if (isVariationSelector(storedChar)) {
        if (echoedChar === "?") {
          echoedIndex += 1
        }
        storedIndex += 1
        continue
      }
      if (isPictograph(storedChar) && echoedChar === "?") {
        // The low surrogate is its own "?". A real "?" after the emoji still
        // has to line up, so a second mark is optional.
        if (
          isSupplementary(storedChar) &&
          right[echoedIndex + 1] === "?" &&
          matches(storedIndex + 1, echoedIndex + 2)
        ) {
          return true
        }
        storedIndex += 1
        echoedIndex += 1
        continue
      }
      return false
    }
    while (
      storedIndex < left.length &&
      isVariationSelector(left[storedIndex] ?? "")
    ) {
      storedIndex += 1
    }
    return storedIndex === left.length && echoedIndex === right.length
  }
  return matches(0, 0)
}

export const isSameZzapHistoryEcho = (
  stored: string | null | undefined,
  echoed: string | null | undefined,
): boolean => {
  const left = zzapHistoryEchoText(stored)
  const right = zzapHistoryEchoText(echoed)
  if (left.length === 0 || right.length === 0) {
    return false
  }
  if (left === right) {
    return true
  }
  const unsignedEcho = withoutSenderSignature(right)
  if (unsignedEcho !== right && unsignedEcho === left) {
    return true
  }
  if (sameAfterZzapSymbolLoss(left, right)) {
    return true
  }
  return unsignedEcho !== right && sameAfterZzapSymbolLoss(left, unsignedEcho)
}

/** A row ChatbotX created for its own send, not one previously imported from ZZAP. */
export const isChatbotXOutgoing = (message: {
  senderType: string
  senderId?: string | null
}): boolean =>
  message.senderType === "bot" ||
  message.senderType === "api" ||
  (message.senderType === "user" && message.senderId != null)
