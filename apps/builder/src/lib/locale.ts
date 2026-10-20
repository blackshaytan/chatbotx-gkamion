"use server"

import { cookies, headers } from "next/headers"
import {
  defaultLocale,
  type Locale,
  pickAcceptLanguageLocale,
} from "@/i18n/config"

// In this example the locale is read from a cookie. You could alternatively
// also read it from a database, backend service, or any other source.
const COOKIE_NAME = "NEXT_LOCALE"

export async function getUserLocale() {
  const cookieLocale = (await cookies()).get(COOKIE_NAME)?.value
  if (cookieLocale) {
    return cookieLocale
  }
  const acceptLanguage = (await headers()).get("accept-language")
  return pickAcceptLanguageLocale(acceptLanguage) ?? defaultLocale
}

export async function setUserLocale(locale: Locale) {
  ;(await cookies()).set(COOKIE_NAME, locale)
}
