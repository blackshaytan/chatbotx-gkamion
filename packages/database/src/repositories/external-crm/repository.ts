import type { DatabaseClient } from "../../client"
import { and, db, eq, or, sql } from "../../client"
import { contactModel } from "../../schema"

export const findExternalCustomerIdentity = async (
  tx: DatabaseClient,
  input: { workspaceId: string; provider: string; externalCustomerId: string },
) =>
  await tx.query.externalCustomerIdentityModel.findFirst({
    where: input,
    with: { contact: true },
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

export const getExternalOrderHistory = async (input: {
  workspaceId: string
  provider: string
  externalOrderId: string
}) =>
  await db.query.externalOrderEventModel.findMany({
    where: input,
    orderBy: { occurredAt: "asc", createdAt: "asc" },
  })
