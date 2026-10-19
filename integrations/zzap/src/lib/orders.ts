// Same patterns as Geka (`zzap_customer_link.extract_order_codes`).
const ORDER_CODE_PATTERN =
  /(?:заказ|order|по\s+заказу)\s*#?\s*(\d{6,12})|#\s*(\d{6,12})/giu
const ORDER_HEAD_PATTERN = /(?:заказ\p{L}*|orders?)\s*[:#№]?/giu
const ORDER_NUMBER_PATTERN = /\d{6,12}/g
const ORDER_NUMBER_PROBE = /\d{6,12}/
const ORDER_TAIL_LENGTH = 160
const ORDER_TAIL_PROBE_LENGTH = 48

/** ZZAP order numbers a buyer mentions in chat, in order of appearance. */
export const extractOrderCodes = (text: string): string[] => {
  const codes = new Set<string>()
  for (const match of text.matchAll(ORDER_CODE_PATTERN)) {
    const code = match[1] ?? match[2]
    if (code) {
      codes.add(code)
    }
  }
  for (const head of text.matchAll(ORDER_HEAD_PATTERN)) {
    const start = (head.index ?? 0) + head[0].length
    const tail = text.slice(start, start + ORDER_TAIL_LENGTH)
    if (!ORDER_NUMBER_PROBE.test(tail.slice(0, ORDER_TAIL_PROBE_LENGTH))) {
      continue
    }
    for (const number of tail.matchAll(ORDER_NUMBER_PATTERN)) {
      codes.add(number[0])
    }
  }
  return [...codes]
}
