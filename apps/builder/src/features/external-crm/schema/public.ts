import {
  createSelectSchema,
  externalOrderEventModel,
  externalOrderModel,
} from "@chatbotx.io/database/schema"
import { z } from "zod"

const externalOrderData = z.object({
  itemSummary: z.string().max(4000).optional(),
  amount: z.number().finite().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  paymentStatus: z.string().max(100).optional(),
  deliveryMethod: z.string().max(100).optional(),
})

export const externalCustomerPublicInput = z.object({
  externalCustomerId: z.string().trim().min(1).max(255),
  firstName: z.string().trim().max(255).optional(),
  lastName: z.string().trim().max(255).optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  phoneNumber: z.string().trim().max(40).optional(),
})

export const syncExternalCustomerPublicRequest = z.object({
  customer: externalCustomerPublicInput,
})

export const recordExternalOrderEventPublicRequest = z.object({
  eventId: z.string().trim().min(1).max(255),
  externalCustomerId: z.string().trim().min(1).max(255),
  externalOrderId: z.string().trim().min(1).max(255),
  eventType: z.enum(["orderCreated", "paymentReceived", "statusChanged"]),
  status: z.string().trim().min(1).max(100),
  occurredAt: z.iso.datetime().transform((value) => new Date(value)),
  orderData: externalOrderData,
  customer: externalCustomerPublicInput
    .omit({ externalCustomerId: true })
    .optional(),
})

export const getExternalCustomerPublicRequest = z.object({
  externalCustomerId: z.string().trim().min(1).max(255),
})

export const externalOrderPublicResource = createSelectSchema(
  externalOrderModel,
  {
    id: z.string(),
    contactId: z.string(),
    workspaceId: z.string(),
  },
)

export const externalOrderEventPublicResource = createSelectSchema(
  externalOrderEventModel,
  {
    id: z.string(),
    workspaceId: z.string(),
  },
)

export const getExternalCustomerPublicResponse = z.object({
  contactId: z.string(),
  orders: z.array(externalOrderPublicResource),
})

export const getExternalOrderHistoryPublicResponse = z.object({
  order: externalOrderPublicResource,
  events: z.array(externalOrderEventPublicResource),
})
