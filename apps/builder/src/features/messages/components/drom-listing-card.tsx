"use client"

import { ExternalLinkIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import type { DromListingLink } from "../lib/drom-listing"

/** The bulletin the buyer opened, shown once above the first message. */
export const DromListingCard = ({ listing }: { listing: DromListingLink }) => {
  const t = useTranslations("messages.dromListing")
  const title = listing.title || t("productCard")

  return (
    <div
      className="mx-auto my-2 flex w-full max-w-md flex-col gap-1 rounded-xl border bg-card px-4 py-3 text-start text-card-foreground shadow-xs"
      data-slot="drom-listing"
    >
      <span className="font-medium text-sm">{t("onDrom")}</span>
      <a
        className="inline-flex items-start gap-1.5 text-primary text-sm hover:underline"
        href={listing.url}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span className="wrap-break-word">{title}</span>
        <ExternalLinkIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      </a>
    </div>
  )
}
