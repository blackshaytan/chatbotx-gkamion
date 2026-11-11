"use client"

import { ExternalLinkIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { formatPrice } from "@/lib/format-price"
import type { DromContextCardData } from "../lib/drom-context-card"

/**
 * The DROM ad or order the customer is writing from, above their message.
 *
 * Without it the thread shows the customer's own words only: «Подойдёт ли на
 * Kia Magentis 2007» says nothing about which part of the catalog is being
 * discussed, and the agent had no link back to the card on baza.drom.ru.
 */
export function DromContextCard({ card }: { card: DromContextCardData }) {
  const t = useTranslations("messages.dromContext")
  const locale = useLocale()
  const priceLabel =
    card.price === null ? null : formatPrice(locale, card.price, "RUB")
  const isDeal = card.kind === "deal"

  return (
    <div
      className="mb-1 flex flex-col gap-1 rounded-md border border-dashed bg-muted/40 px-2 py-1.5"
      data-slot="drom-context-card"
    >
      <span className="text-muted-foreground text-xs">
        {isDeal ? t("dealPrefix") : t("listingPrefix")}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
        <ExternalLinkIcon
          aria-hidden
          className="size-3.5 flex-none text-muted-foreground"
        />
        <a
          className="min-w-0 truncate font-medium underline underline-offset-2"
          href={card.href}
          rel="noopener noreferrer"
          target="_blank"
        >
          {card.title || (isDeal ? t("openDeal") : t("openListing"))}
        </a>
        {priceLabel && (
          <span className="flex-none text-muted-foreground text-xs">
            · {priceLabel}
          </span>
        )}
      </div>
      {isDeal && card.itemsCount > 1 && (
        <span className="text-muted-foreground text-xs">
          {t("itemsCount", { count: card.itemsCount })}
        </span>
      )}
    </div>
  )
}
