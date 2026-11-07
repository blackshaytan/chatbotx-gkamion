"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import { useQuery } from "@tanstack/react-query"
import { Loader2Icon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect } from "react"
import type { z } from "zod"
import { orpc } from "@/lib/orpc/query"
import type { contactGkamionProfile } from "../schema/contact-orders"

type GkamionProfile = z.infer<typeof contactGkamionProfile>

type ContactOrdersSectionProps = {
  workspaceId: string
  contactId: string
  onProfileApplied?: (profile: GkamionProfile) => void
}

const CURRENCY_CODE = /^[A-Za-z]{3}$/

const isHiddenContactOrderStatus = (status: string): boolean => {
  const normalized = status.trim().toLocaleLowerCase("ru")
  return (
    normalized === "выдано" ||
    normalized === "снят" ||
    normalized.startsWith("отказ")
  )
}

const formatUpdatedAt = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

const formatAmount = (amount: number, currency?: string): string => {
  const number = new Intl.NumberFormat(undefined).format(amount)
  if (!(currency && CURRENCY_CODE.test(currency))) {
    return number
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount)
  } catch {
    return number
  }
}

export const ContactOrdersSection = ({
  workspaceId,
  contactId,
  onProfileApplied,
}: ContactOrdersSectionProps) => {
  const t = useTranslations()
  const { data, isPending, isError, refetch, isFetching } = useQuery(
    orpc.contactsAPIs.listContactOrdersAuthenticatedAPI.queryOptions({
      input: { workspaceId, contactId },
    }),
  )

  useEffect(() => {
    if (data?.profile?.updated) {
      onProfileApplied?.(data.profile)
    }
  }, [data?.profile, onProfileApplied])
  const orders = data?.data.filter(
    (order) => !isHiddenContactOrderStatus(order.status),
  )

  const renderOrders = () => {
    if (isPending || (isFetching && !data)) {
      return (
        <div className="flex justify-center py-3">
          <Loader2Icon
            aria-label={t("contacts.orders.title")}
            className="size-4 animate-spin text-muted-foreground"
          />
        </div>
      )
    }
    if (isError) {
      return (
        <div className="mt-2 flex items-center gap-2 text-muted-foreground text-sm">
          <span>{t("messages.errorLoadingData")}</span>
          <Button
            onClick={() => {
              refetch().catch(() => undefined)
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("actions.retry")}
          </Button>
        </div>
      )
    }
    if (!orders || orders.length === 0) {
      return (
        <p className="mt-2 text-muted-foreground text-sm">
          {t("contacts.orders.empty")}
        </p>
      )
    }
    return (
      <div className="mt-2 space-y-3">
        {orders.map((order) => (
          <div className="min-w-0 space-y-0.5" key={order.externalOrderId}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-sm">
                {t("contacts.orders.number")} {order.externalOrderId}
              </span>
              <span className="shrink-0 text-xs">
                {t("contacts.orders.status")}: {order.status}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {t("contacts.orders.updated")}:{" "}
              {formatUpdatedAt(order.lastEventAt)}
            </p>
            {order.amount === undefined ? null : (
              <p className="text-xs">
                {t("contacts.orders.amount")}:{" "}
                {formatAmount(order.amount, order.currency)}
              </p>
            )}
            {order.itemSummary ? (
              <p className="truncate text-xs">
                {t("contacts.orders.items")}: {order.itemSummary}
              </p>
            ) : null}
            {order.deliveryMethod ? (
              <p className="truncate text-xs">
                {t("contacts.orders.delivery")}: {order.deliveryMethod}
              </p>
            ) : null}
            {order.paymentStatus ? (
              <p className="truncate text-xs">
                {t("contacts.orders.payment")}: {order.paymentStatus}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    )
  }

  return (
    <section className="border-t px-2 py-3">
      <h2 className="font-medium text-sm">{t("contacts.orders.title")}</h2>
      {renderOrders()}
    </section>
  )
}
