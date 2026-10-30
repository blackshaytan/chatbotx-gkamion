export type ContactOrderSnapshot = {
  externalOrderId: string
  externalCustomerId: string
  status: string
  lastEventAt: Date
  itemSummary?: string
  amount?: number
  currency?: string
  paymentStatus?: string
  deliveryMethod?: string
}

const optionalText = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const optionalAmount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined

const snapshotRecord = (data: unknown): Record<string, unknown> =>
  data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}

export const toContactOrderSnapshot = (row: {
  externalOrderId: string
  externalCustomerId: string
  status: string
  lastEventAt: Date
  data: unknown
}): ContactOrderSnapshot => {
  const data = snapshotRecord(row.data)
  const itemSummary = optionalText(data.itemSummary)
  const amount = optionalAmount(data.amount)
  const currency = optionalText(data.currency)
  const paymentStatus = optionalText(data.paymentStatus)
  const deliveryMethod = optionalText(data.deliveryMethod)

  return {
    externalOrderId: row.externalOrderId,
    externalCustomerId: row.externalCustomerId,
    status: row.status,
    lastEventAt: row.lastEventAt,
    ...(itemSummary !== undefined && { itemSummary }),
    ...(amount !== undefined && { amount }),
    ...(currency !== undefined && { currency }),
    ...(paymentStatus !== undefined && { paymentStatus }),
    ...(deliveryMethod !== undefined && { deliveryMethod }),
  }
}
