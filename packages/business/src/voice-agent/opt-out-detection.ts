const PATTERNS = [
  /(?<!\p{L})больше не (звоните|звони)(?!\p{L})/u,
  /(?<!\p{L})не (звоните|звони) мне больше(?!\p{L})/u,
  /(?<!\p{L})не (звоните|звони)( мне)? больше(?!\p{L})/u,
  /(?<!\p{L})не (звоните|звони) мне(?!\p{L})/u,
  /(?<!\p{L})хватит( мне)? звонить(?!\p{L})/u,
  /(?<!\p{L})(уберите|удалите|исключите)( мой)? номер( из)?( базы| обзвона| списка| рассылки)?(?!\p{L})/u,
  /(?<!\p{L})не хочу чтобы( мне)? звонили?(?!\p{L})/u,
]

const NEGATIVE = [
  /перезвон/u,
  /позвоните/u,
  /жду звонка/u,
  /наберите/u,
  /сам приеду/u,
  /сам заберу/u,
  /сам позвоню/u,
  /сам наберу/u,
  /(?<!\p{L})почему(?!\p{L})/u,
  /(?<!\p{L})когда(?!\p{L})/u,
  /(?<!\p{L})кто(?!\p{L})/u,
]

export function detectOptOutRequest(text: string) {
  const normalized = text
    .toLowerCase()
    .replaceAll("ё", "е")
    .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
  if (!normalized || NEGATIVE.some((p) => p.test(normalized))) {
    return { matched: false } as const
  }
  for (const pattern of PATTERNS) {
    const found = pattern.exec(normalized)
    if (found) {
      return { matched: true, phrase: found[0] } as const
    }
  }
  return { matched: false } as const
}
