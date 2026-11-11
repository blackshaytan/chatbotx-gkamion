/**
 * Order-notification decisions. n8n sends the fact; ChatbotX chooses the
 * text, the checks, and the channel. These functions do not touch the
 * database or a channel — the service and the worker apply them.
 */

export const ORDER_NOTIFICATION_CHANNELS = [
  "max",
  "telegram",
  "zzap",
  "drom",
  "smtp",
] as const

export type OrderNotificationChannel =
  (typeof ORDER_NOTIFICATION_CHANNELS)[number]

export type OrderNotificationSubject = "order" | "item"

export type OrderNotificationPackage = {
  deliveryMethod?: "pickup" | "delivery"
  hasDebt?: boolean
  amount?: number
  itemSummary?: string
  billUrl?: string
  orderNumber?: string
  phone?: string
  email?: string
}

export type OrderNotificationAttempt = {
  channel: OrderNotificationChannel | null
  outcome: "accepted" | "rejected" | "unclear" | "error"
  reason?: string
  at: string
}

export type OrderNotificationRunResult = {
  kind: "orderNotification"
  eventId: string
  subject: OrderNotificationSubject
  externalOrderId: string
  externalOrderItemId?: string
  package: OrderNotificationPackage
  sendStarted: boolean
  terminal: boolean
  reason?: string
  attempts: OrderNotificationAttempt[]
  loggedAt: string
}

export const ORDER_NOTIFICATION_FIELDS = [
  "deliveryMethod",
  "hasDebt",
  "amount",
] as const

export type OrderNotificationField = (typeof ORDER_NOTIFICATION_FIELDS)[number]

const ORDER_FIELD_SET = new Set<string>(ORDER_NOTIFICATION_FIELDS)

export const isOrderNotificationField = (
  field: string,
): field is OrderNotificationField => ORDER_FIELD_SET.has(field)

const optionalText = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export const readOrderNotificationPackage = (
  data: Record<string, unknown>,
): OrderNotificationPackage => {
  const deliveryMethod = optionalText(data.deliveryMethod)
  const amount =
    typeof data.amount === "number" && Number.isFinite(data.amount)
      ? data.amount
      : undefined
  return {
    ...(deliveryMethod === "pickup" || deliveryMethod === "delivery"
      ? { deliveryMethod }
      : {}),
    ...(typeof data.hasDebt === "boolean" ? { hasDebt: data.hasDebt } : {}),
    ...(amount === undefined ? {} : { amount }),
    ...(optionalText(data.itemSummary) === undefined
      ? {}
      : { itemSummary: optionalText(data.itemSummary) }),
    ...(optionalText(data.billUrl) === undefined
      ? {}
      : { billUrl: optionalText(data.billUrl) }),
    ...(optionalText(data.orderNumber) === undefined
      ? {}
      : { orderNumber: optionalText(data.orderNumber) }),
    ...(optionalText(data.phone) === undefined
      ? {}
      : { phone: optionalText(data.phone) }),
    ...(optionalText(data.email) === undefined
      ? {}
      : { email: optionalText(data.email)?.toLowerCase() }),
  }
}

export type EventDecision =
  | { kind: "reject" }
  | { kind: "duplicate" }
  | { kind: "resume" }
  | { kind: "history" }
  | { kind: "accept" }

/**
 * What to do with one delivery of an order event.
 *
 * `runsCreated` is false when the event was stored but the flow runs were
 * not. A retry then only creates the runs. An older `occurredAt` is kept
 * as history and starts nothing.
 */
export const decideOrderEvent = (input: {
  linked: boolean
  hasPhoneOrEmail: boolean
  existing: { runsCreated: boolean } | null
  latestAcceptedAt: Date | null
  occurredAt: Date
}): EventDecision => {
  if (!(input.linked || input.hasPhoneOrEmail)) {
    return { kind: "reject" }
  }
  if (input.existing?.runsCreated) {
    return { kind: "duplicate" }
  }
  if (input.existing) {
    return { kind: "resume" }
  }
  if (
    input.latestAcceptedAt &&
    input.occurredAt.getTime() < input.latestAcceptedAt.getTime()
  ) {
    return { kind: "history" }
  }
  return { kind: "accept" }
}

export const notificationRunsCreated = (data: unknown): boolean =>
  typeof data === "object" &&
  data !== null &&
  !Array.isArray(data) &&
  (data as { notificationRunsCreated?: unknown }).notificationRunsCreated ===
    true

export type NotificationSubscription = {
  subject: OrderNotificationSubject
  statusIds: number[]
}

type FlowNodeLike = {
  data?: {
    details?: {
      steps?: unknown
    }
  }
}

const readSubscription = (step: unknown): NotificationSubscription | null => {
  if (typeof step !== "object" || step === null) {
    return null
  }
  const record = step as {
    stepType?: unknown
    subject?: unknown
    statusIds?: unknown
  }
  if (record.stepType !== "sendOrderNotification") {
    return null
  }
  if (record.subject !== "order" && record.subject !== "item") {
    return null
  }
  if (!Array.isArray(record.statusIds)) {
    return null
  }
  const statusIds = record.statusIds.filter(
    (statusId): statusId is number =>
      typeof statusId === "number" && Number.isInteger(statusId),
  )
  if (statusIds.length === 0) {
    return null
  }
  return { subject: record.subject, statusIds }
}

export const flowMatchesOrderStatus = (
  nodes: readonly unknown[],
  input: { subject: OrderNotificationSubject; statusId: number },
): boolean => {
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) {
      continue
    }
    const steps = (node as FlowNodeLike).data?.details?.steps
    if (!Array.isArray(steps)) {
      continue
    }
    for (const step of steps) {
      const subscription = readSubscription(step)
      if (
        subscription?.subject === input.subject &&
        subscription.statusIds.includes(input.statusId)
      ) {
        return true
      }
    }
  }
  return false
}

type OrderCondition = {
  field: string
  operator: string
  value?: string | string[] | [string, string]
}

const conditionValue = (value: OrderCondition["value"]): string | undefined => {
  if (typeof value === "string") {
    return value.trim()
  }
  return
}

const amountThreshold = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === "") {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const truthy = (value: string | undefined): boolean | null => {
  if (value === undefined) {
    return null
  }
  if (value === "true" || value === "yes" || value === "1") {
    return true
  }
  if (value === "false" || value === "no" || value === "0") {
    return false
  }
  return null
}

/** One check against the package this run started with. A missing field does not match. */
export const orderConditionMatches = (
  condition: OrderCondition,
  orderPackage: OrderNotificationPackage,
): boolean => {
  if (!isOrderNotificationField(condition.field)) {
    return false
  }
  const value = conditionValue(condition.value)
  if (condition.field === "deliveryMethod") {
    if (orderPackage.deliveryMethod === undefined) {
      return false
    }
    return (
      (condition.operator === "is" || condition.operator === "equals") &&
      value === orderPackage.deliveryMethod
    )
  }
  if (condition.field === "hasDebt") {
    if (orderPackage.hasDebt === undefined) {
      return false
    }
    const expected = truthy(value)
    return (
      expected !== null &&
      (condition.operator === "is" || condition.operator === "equals") &&
      expected === orderPackage.hasDebt
    )
  }
  if (orderPackage.amount === undefined) {
    return false
  }
  const threshold = amountThreshold(value)
  if (threshold === null) {
    return false
  }
  switch (condition.operator) {
    case "gt":
      return orderPackage.amount > threshold
    case "gte":
      return orderPackage.amount >= threshold
    case "lt":
      return orderPackage.amount < threshold
    case "lte":
      return orderPackage.amount <= threshold
    default:
      return false
  }
}

export const orderConditionGroupMatches = (
  input: {
    operator: "and" | "or"
    conditions: readonly OrderCondition[]
  },
  orderPackage: OrderNotificationPackage,
): boolean => {
  if (input.conditions.length === 0) {
    return false
  }
  const results = input.conditions.map((condition) =>
    orderConditionMatches(condition, orderPackage),
  )
  return input.operator === "or"
    ? results.some(Boolean)
    : results.every(Boolean)
}

const TEMPLATE = /\{\{\s*(orderNumber|itemSummary|amount|billUrl)\s*\}\}/g

/** Missing package values leave an empty place. The message is still sent. */
export const renderOrderNotificationText = (
  template: string,
  orderPackage: OrderNotificationPackage,
): string =>
  template.replace(TEMPLATE, (_match, key: string) => {
    if (key === "amount") {
      return orderPackage.amount === undefined
        ? ""
        : String(orderPackage.amount)
    }
    if (key === "orderNumber") {
      return orderPackage.orderNumber ?? ""
    }
    if (key === "itemSummary") {
      return orderPackage.itemSummary ?? ""
    }
    return orderPackage.billUrl ?? ""
  })

export type CascadeCandidate = {
  channel: OrderNotificationChannel
  contactInboxId: string | null
}

export const selectChannelInboxes = (
  inboxes: readonly {
    id: string
    channel: string
    lastMessageAt: Date | null
  }[],
): { channel: OrderNotificationChannel; contactInboxId: string }[] => {
  const chosen: {
    channel: OrderNotificationChannel
    contactInboxId: string
  }[] = []
  for (const channel of ORDER_NOTIFICATION_CHANNELS) {
    const matches = inboxes.filter((inbox) => inbox.channel === channel)
    if (matches.length === 0) {
      continue
    }
    const latest = [...matches].sort((left, right) => {
      const leftAt = left.lastMessageAt?.getTime() ?? Number.NEGATIVE_INFINITY
      const rightAt = right.lastMessageAt?.getTime() ?? Number.NEGATIVE_INFINITY
      if (leftAt !== rightAt) {
        return rightAt - leftAt
      }
      return right.id.localeCompare(left.id)
    })[0]
    if (latest) {
      chosen.push({ channel, contactInboxId: latest.id })
    }
  }
  return chosen
}

/**
 * Messenger channels are skipped when the messenger text is empty. Mail is
 * skipped when the mail text is empty. A missing SMTP dialog is filled only
 * when the package has an email and the workspace has exactly one SMTP inbox.
 */
export const planCascadeCandidates = (input: {
  inboxes: readonly {
    id: string
    channel: string
    lastMessageAt: Date | null
  }[]
  messengerText: string
  emailText: string
  email?: string
  smtpInboxCount: number
}): CascadeCandidate[] => {
  const selected = selectChannelInboxes(input.inboxes)
  const candidates: CascadeCandidate[] = []
  for (const candidate of selected) {
    if (candidate.channel === "smtp") {
      if (input.emailText.trim().length > 0) {
        candidates.push(candidate)
      }
      continue
    }
    if (input.messengerText.trim().length > 0) {
      candidates.push(candidate)
    }
  }
  const hasSmtp = candidates.some((candidate) => candidate.channel === "smtp")
  if (
    !hasSmtp &&
    input.emailText.trim().length > 0 &&
    input.email &&
    input.smtpInboxCount === 1
  ) {
    candidates.push({ channel: "smtp", contactInboxId: null })
  }
  return candidates
}

const PERMANENT_CHANNEL_CATEGORIES = new Set([
  "auth_failed",
  "user_blocked",
  "invalid_recipient",
  "permission_denied",
  "payload_invalid",
  "quota_exceeded",
])

/** A timeout or a dropped connection is unclear. An explicit refusal is a rejection. */
export const classifyChannelFailure = (input: {
  category?: string | null
  timedOut?: boolean
}): "rejected" | "unclear" => {
  if (input.timedOut) {
    return "unclear"
  }
  if (input.category && PERMANENT_CHANNEL_CATEGORIES.has(input.category)) {
    return "rejected"
  }
  return "unclear"
}

export type CascadeAction =
  | { action: "send"; candidate: CascadeCandidate }
  | {
      action: "stop"
      status: "success" | "error"
      reason: "accepted" | "unclear" | "exhausted" | "empty"
    }

export const nextCascadeAction = (input: {
  candidates: readonly CascadeCandidate[]
  attempts: readonly Pick<OrderNotificationAttempt, "channel" | "outcome">[]
  messengerText: string
  emailText: string
}): CascadeAction => {
  if (
    input.messengerText.trim().length === 0 &&
    input.emailText.trim().length === 0
  ) {
    return { action: "stop", status: "error", reason: "empty" }
  }
  if (input.attempts.some((attempt) => attempt.outcome === "accepted")) {
    return { action: "stop", status: "success", reason: "accepted" }
  }
  const last = input.attempts.at(-1)
  if (last?.outcome === "unclear" || last?.outcome === "error") {
    return { action: "stop", status: "error", reason: "unclear" }
  }
  const tried = new Set(
    input.attempts
      .map((attempt) => attempt.channel)
      .filter(
        (channel): channel is OrderNotificationChannel => channel !== null,
      ),
  )
  const next = input.candidates.find(
    (candidate) => !tried.has(candidate.channel),
  )
  if (!next) {
    return { action: "stop", status: "error", reason: "exhausted" }
  }
  return { action: "send", candidate: next }
}

export type NotificationWaitMetadata = {
  type?: unknown
  subject?: unknown
  externalOrderId?: unknown
  externalOrderItemId?: unknown
  flowRunId?: unknown
}

export const readNotificationWait = (
  metadata: unknown,
): NotificationWaitMetadata | null => {
  if (typeof metadata !== "object" || metadata === null) {
    return null
  }
  return metadata as NotificationWaitMetadata
}

/**
 * A new order event cancels only waits for that same order. A new item
 * event cancels only waits for that item. A run that already entered the
 * send step is left alone.
 */
export const isCancelableNotificationWait = (input: {
  metadata: unknown
  subject: OrderNotificationSubject
  externalOrderId: string
  externalOrderItemId?: string
  sendStartedRunIds: ReadonlySet<string>
}): boolean => {
  const metadata = readNotificationWait(input.metadata)
  if (metadata?.type !== "orderNotification") {
    return false
  }
  if (metadata.subject !== input.subject) {
    return false
  }
  if (metadata.externalOrderId !== input.externalOrderId) {
    return false
  }
  if (
    input.subject === "item" &&
    metadata.externalOrderItemId !== input.externalOrderItemId
  ) {
    return false
  }
  if (
    typeof metadata.flowRunId === "string" &&
    input.sendStartedRunIds.has(metadata.flowRunId)
  ) {
    return false
  }
  return true
}

export const NOTIFICATION_LOG_RETENTION_DAYS = 30

export const notificationLogExpired = (loggedAt: Date, now: Date): boolean =>
  now.getTime() - loggedAt.getTime() >=
  NOTIFICATION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

export async function runNotificationCascade(input: {
  candidates: readonly CascadeCandidate[]
  attempts: readonly OrderNotificationAttempt[]
  messengerText: string
  emailText: string
  send: (candidate: CascadeCandidate) => Promise<{
    outcome: "accepted" | "rejected" | "unclear"
    reason?: string
  }>
  record: (attempt: OrderNotificationAttempt) => Promise<void>
  now?: () => Date
}): Promise<{ status: "success" | "error"; reason: string }> {
  const attempts = [...input.attempts]
  const now = input.now ?? (() => new Date())
  for (;;) {
    const action = nextCascadeAction({
      candidates: input.candidates,
      attempts,
      messengerText: input.messengerText,
      emailText: input.emailText,
    })
    if (action.action === "stop") {
      return { status: action.status, reason: action.reason }
    }
    const result = await input.send(action.candidate)
    const attempt: OrderNotificationAttempt = {
      channel: action.candidate.channel,
      outcome: result.outcome,
      ...(result.reason ? { reason: result.reason } : {}),
      at: now().toISOString(),
    }
    await input.record(attempt)
    attempts.push(attempt)
  }
}
