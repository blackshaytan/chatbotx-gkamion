import type { z } from "zod"
import type { contactOrderResource } from "../schema/contact-orders"

export type ContactOrder = z.infer<typeof contactOrderResource>

type GkamionOrderItem = {
  status_id?: number | string | null
  detail_name?: string | null
  make_name?: string | null
  cost?: number | string | null
  qnt?: number | string | null
}

export type GkamionOrderRow = {
  id?: number | string | null
  customer_id?: number | string | null
  updated_at?: string | null
  created_at?: string | null
  delivery_type?: unknown
  payment_type?: {
    name?: string | null
    payment_type?: { name?: string | null } | null
  } | null
  order_items?: GkamionOrderItem[] | null
}

/** Same closed statuses the dashboard card hides. */
const INACTIVE_ORDER_STATUS_IDS = new Set([8, 9, 10, 17, 18, 26])

export const GKAMION_ORDER_STATUS_LABELS: Record<number, string> = {
  1: "Обрабатывается",
  2: "В работе",
  3: "В заказе",
  4: "Размещено у поставщика",
  5: "В пути на ЦС",
  6: "Отгружено поставщиком",
  7: "Пришло",
  8: "Выдано",
  9: "Отказ",
  10: "Снят",
  11: "Возврат -> Одобрен",
  12: "Проверка по ВИН",
  13: "Ожидает оплаты",
  14: "Сбой размещения заказа",
  15: "На сборке",
  16: "Поступил в пункт выдачи",
  17: "Отказ клиента",
  18: "Отказ поставщика",
  19: "Запрошено снятие",
  20: "Требует внимания",
  21: "Самовывоз -> 2 дня",
  22: "Самовывоз -> 4 дня",
  23: "Самовывоз -> 7 дней",
  24: "Собран на ЦС",
  25: "Самовывоз -> Хранение",
  26: "Предложения не найдены",
  27: "Предоплата просрочена",
  28: "Перезапуск заказа",
  29: "Изменение цены/срока",
  30: "Пришло частично",
  31: "Выдано частично",
  32: "Задержка поставки",
  33: "Подтвержден частично",
  34: "Возврат -> Принят в ПВЗ",
  35: "Возврат -> На согласовании",
  36: "Возврат поставщику",
  37: "Готов к доставке",
  38: "Самовывоз -> запрос счета",
}

const ITEM_SUMMARY_MAX = 240

const statusIdOf = (item: GkamionOrderItem): number | null => {
  const value = Number(item.status_id)
  return Number.isInteger(value) ? value : null
}

const statusName = (
  statusId: number,
  labels: ReadonlyMap<number, string>,
): string => labels.get(statusId) ?? `Статус ${statusId}`

const lineAmount = (item: GkamionOrderItem): number | null => {
  const cost = Number(item.cost)
  if (!Number.isFinite(cost)) {
    return null
  }
  const quantity = Number(item.qnt)
  const count = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
  return cost * count
}

const itemLabel = (item: GkamionOrderItem): string =>
  [item.make_name, item.detail_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ")

const paymentName = (order: GkamionOrderRow): string | undefined => {
  const nested = order.payment_type?.payment_type?.name?.trim()
  const direct = order.payment_type?.name?.trim()
  return nested || direct || undefined
}

const deliveryName = (order: GkamionOrderRow): string | undefined =>
  typeof order.delivery_type === "string" && order.delivery_type.trim()
    ? order.delivery_type.trim()
    : undefined

const eventTime = (order: GkamionOrderRow): Date => {
  const raw = order.updated_at || order.created_at
  const parsed = raw ? new Date(raw) : new Date()
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

/**
 * One card row per order. Issued, cancelled, and supplier-rejected orders
 * are omitted. A mixed order keeps the status shared by its open lines.
 */
export const toContactOrder = (
  order: GkamionOrderRow,
  customerId: string,
  labels: ReadonlyMap<number, string>,
): ContactOrder | null => {
  const orderId = order.id
  if (orderId == null || String(orderId).trim() === "") {
    return null
  }
  const items = order.order_items ?? []
  const statuses = items
    .map(statusIdOf)
    .filter((statusId): statusId is number => statusId != null)
  const live = statuses.filter(
    (statusId) => !INACTIVE_ORDER_STATUS_IDS.has(statusId),
  )
  if (live.length === 0) {
    return null
  }
  const sameStatus = live.every((statusId) => statusId === live[0])
  const status = sameStatus ? statusName(live[0], labels) : "Разные статусы"
  const liveItems = items.filter((item) => {
    const statusId = statusIdOf(item)
    return statusId != null && !INACTIVE_ORDER_STATUS_IDS.has(statusId)
  })
  const summary = liveItems
    .map(itemLabel)
    .filter((label) => label.length > 0)
    .join("; ")
  const amounts = liveItems
    .map(lineAmount)
    .filter((amount): amount is number => amount != null)
  const amount =
    amounts.length > 0
      ? amounts.reduce((total, value) => total + value, 0)
      : undefined

  return {
    externalOrderId: String(orderId),
    externalCustomerId: String(order.customer_id ?? customerId),
    status,
    lastEventAt: eventTime(order),
    itemSummary: summary ? summary.slice(0, ITEM_SUMMARY_MAX) : undefined,
    amount,
    currency: amount === undefined ? undefined : "RUB",
    paymentStatus: paymentName(order),
    deliveryMethod: deliveryName(order),
  }
}

export const mapGkamionOrders = (
  orders: GkamionOrderRow[],
  customerId: string,
  labels: ReadonlyMap<number, string>,
): ContactOrder[] =>
  orders.flatMap((order) => {
    const mapped = toContactOrder(order, customerId, labels)
    return mapped ? [mapped] : []
  })

export const fallbackStatusLabels = (): Map<number, string> =>
  new Map(
    Object.entries(GKAMION_ORDER_STATUS_LABELS).map(([id, name]) => [
      Number(id),
      name,
    ]),
  )

const PLACEHOLDER_NAMES = new Set(["клиент", "покупатель"])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const usablePersonName = (
  value: string | null | undefined,
): string | null => {
  const trimmed = value?.trim() ?? ""
  if (!trimmed || trimmed.includes("#")) {
    return null
  }
  if (PLACEHOLDER_NAMES.has(trimmed.toLocaleLowerCase("ru"))) {
    return null
  }
  return trimmed
}

export const usableEmail = (
  value: string | null | undefined,
): string | null => {
  const trimmed = value?.trim() ?? ""
  if (!trimmed || trimmed.includes("#") || !EMAIL_RE.test(trimmed)) {
    return null
  }
  return trimmed
}

export const ordersFromBody = (body: unknown): GkamionOrderRow[] => {
  if (!body || typeof body !== "object") {
    return []
  }
  const record = body as { orders?: unknown; data?: unknown }
  const rows = record.orders ?? record.data
  return Array.isArray(rows) ? (rows as GkamionOrderRow[]) : []
}

export const mergeStatusLabels = (
  body: unknown,
  labels: Map<number, string>,
): Map<number, string> => {
  if (!body || typeof body !== "object") {
    return labels
  }
  const rows = (body as { order_status_types?: unknown }).order_status_types
  if (!Array.isArray(rows)) {
    return labels
  }
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue
    }
    const id = Number((row as { id?: unknown }).id)
    const name = String((row as { name?: unknown }).name ?? "").trim()
    if (Number.isInteger(id) && name) {
      labels.set(id, name)
    }
  }
  return labels
}
