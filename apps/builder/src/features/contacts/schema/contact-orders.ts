import { z } from "zod"

export const contactOrderResource = z.object({
  externalOrderId: z.string().describe("Order id in gKamion."),
  externalCustomerId: z.string().describe("Customer id in gKamion."),
  status: z.string().describe("Current order status label."),
  lastEventAt: z.coerce
    .date()
    .describe("When this order status was last recorded."),
  itemSummary: z.string().optional().describe("Short list of line items."),
  amount: z.number().optional().describe("Order total in currency units."),
  currency: z
    .string()
    .optional()
    .describe("ISO 4217 currency code, when known."),
  paymentStatus: z
    .string()
    .optional()
    .describe("Payment state supplied by gKamion."),
  deliveryMethod: z
    .string()
    .optional()
    .describe("Delivery method supplied by gKamion."),
})

export const listContactOrdersResponse = z.object({
  data: z.array(contactOrderResource),
})
