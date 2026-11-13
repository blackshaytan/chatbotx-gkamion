import type { DatabaseClient } from "../../client"
import { and, db, eq, inArray, ne, or, sql } from "../../client"
import { contactModel, externalOrderEventModel } from "../../schema"

export const findExternalCustomerIdentity = async (
  tx: DatabaseClient,
  input: { workspaceId: string; provider: string; externalCustomerId: string },
) =>
  await tx.query.externalCustomerIdentityModel.findFirst({
    where: input,
    with: { contact: true },
  })

export const listExternalCustomerIdentitiesForContact = async (
  tx: DatabaseClient,
  input: { workspaceId: string; contactId: string; provider: string },
) =>
  await tx.query.externalCustomerIdentityModel.findMany({
    where: input,
    columns: { externalCustomerId: true },
  })

export const findContactMatches = async (
  tx: DatabaseClient,
  input: { workspaceId: string; email?: string; phoneNumber?: string },
) =>
  await tx
    .select({ id: contactModel.id })
    .from(contactModel)
    .where(
      and(
        eq(contactModel.workspaceId, input.workspaceId),
        or(
          ...(input.email
            ? [sql`lower(${contactModel.email}) = ${input.email.toLowerCase()}`]
            : []),
          ...(input.phoneNumber
            ? [eq(contactModel.phoneNumber, input.phoneNumber)]
            : []),
        ),
      ),
    )
    .limit(3)

export const listExternalOrdersForContact = async (input: {
  workspaceId: string
  provider: string
  contactId: string
}) =>
  await db.query.externalOrderModel.findMany({
    where: input,
    orderBy: { lastEventAt: "desc" },
  })

export const findExternalOrder = async (
  tx: DatabaseClient,
  input: {
    workspaceId: string
    provider: string
    externalOrderId: string
  },
) => await tx.query.externalOrderModel.findFirst({ where: input })

export const findExternalOrderEvent = async (
  tx: DatabaseClient,
  input: { workspaceId: string; provider: string; eventId: string },
) => await tx.query.externalOrderEventModel.findFirst({ where: input })

export const findLatestExternalSubjectEventAt = async (
  tx: DatabaseClient,
  input: {
    workspaceId: string
    provider: string
    externalOrderId: string
    eventTypes: string[]
    externalOrderItemId?: string
    exceptEventId?: string
  },
): Promise<Date | null> => {
  const [row] = await tx
    .select({
      occurredAt: sql<
        Date | string | null
      >`max(${externalOrderEventModel.occurredAt})`,
    })
    .from(externalOrderEventModel)
    .where(
      and(
        eq(externalOrderEventModel.workspaceId, input.workspaceId),
        eq(externalOrderEventModel.provider, input.provider),
        eq(externalOrderEventModel.externalOrderId, input.externalOrderId),
        inArray(externalOrderEventModel.eventType, input.eventTypes),
        input.externalOrderItemId
          ? sql`${externalOrderEventModel.data}->>'externalOrderItemId' = ${input.externalOrderItemId}`
          : undefined,
        input.exceptEventId
          ? ne(externalOrderEventModel.eventId, input.exceptEventId)
          : undefined,
      ),
    )
  if (!row?.occurredAt) {
    return null
  }
  const occurredAt =
    row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt)
  return Number.isNaN(occurredAt.getTime()) ? null : occurredAt
}

export const getExternalOrderHistory = async (input: {
  workspaceId: string
  provider: string
  externalOrderId: string
}) =>
  await db.query.externalOrderEventModel.findMany({
    where: input,
    orderBy: { occurredAt: "asc", createdAt: "asc" },
  })
