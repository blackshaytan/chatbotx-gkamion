"use client"

import { cn } from "@chatbotx.io/ui/lib/utils"
import { useLocale, useTranslations } from "next-intl"
import type { ReactNode } from "react"
import type { DromContextCardData } from "../lib/drom-context-card"

/**
 * DROM paints the bulletin and the «Покупатель выбрал» line as the message
 * itself: pale fill, the part name as a link, the price in bold. These three
 * values are sampled from that bar (fill, edge, link).
 */
const DROM_BUBBLE =
  "w-full rounded-md border border-[#f1e4ff] bg-[#fcf8ff] px-4 py-3 text-sm text-[#1e1e1e]"
const DROM_LINK = "text-[#1a76cb] hover:underline"

const formatRub = (locale: string, price: number) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(price)

/**
 * The ad or order the customer is writing from, as its own bubble.
 *
 * A stored listing title often already reads «9 567 р. • Полуось…»; prepending
 * the price again would show it twice. A deal is the sentence DROM inserts:
 * «Покупатель выбрал {деталь} за {сумма}».
 */
export function DromContextCard({
  card,
  time,
}: {
  card: DromContextCardData
  time?: ReactNode
}) {
  const t = useTranslations("messages.dromContext")
  const locale = useLocale()
  const isDeal = card.kind === "deal"
  const priceLabel = card.price === null ? null : formatRub(locale, card.price)
  const name = card.title || (isDeal ? t("openDeal") : t("openListing"))
  const titleCarriesPrice = !isDeal && name.includes("•")

  const product = (chunks: ReactNode) => (
    <a
      className={DROM_LINK}
      href={card.href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {chunks}
    </a>
  )
  const amount = (chunks: ReactNode) => (
    <strong className="font-semibold">{chunks}</strong>
  )

  let line: ReactNode
  if (isDeal && priceLabel) {
    line = t.rich("dealLine", {
      amount,
      price: priceLabel,
      product,
      title: name,
    })
  } else if (isDeal) {
    line = t.rich("dealLineNoPrice", { product, title: name })
  } else if (priceLabel && !titleCarriesPrice) {
    line = t.rich("listingLine", {
      amount,
      price: priceLabel,
      product,
      title: name,
    })
  } else {
    line = product(name)
  }

  return (
    <div className={cn(DROM_BUBBLE)} data-slot="drom-context-card">
      <div className="flex items-start justify-between gap-3">
        <p className="wrap-break-word min-w-0">{line}</p>
        {time}
      </div>
      {isDeal && card.itemsCount > 1 && (
        <span className="text-[#1e1e1e]/70 text-xs">
          {t("itemsCount", { count: card.itemsCount })}
        </span>
      )}
    </div>
  )
}
