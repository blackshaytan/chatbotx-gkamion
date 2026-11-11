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

export const contactGkamionProfile = z.object({
  firstName: z.string().nullable().describe("Given name after the pull."),
  lastName: z.string().nullable().describe("Surname after the pull."),
  email: z.string().nullable().describe("Email after the pull."),
  phoneNumber: z
    .string()
    .nullable()
    .describe("Phone already stored on the contact."),
  fullName: z.string().nullable().describe("Given name and surname joined."),
  gkamionCustomerId: z
    .string()
    .describe("gKamion customer id used for the pull."),
  updated: z
    .boolean()
    .describe("True when an empty name or email on the contact was filled."),
})

export const listContactOrdersResponse = z.object({
  data: z.array(contactOrderResource),
  profile: contactGkamionProfile
    .optional()
    .describe(
      "Present when the orders were read live from gKamion. Absent when the list is the stored snapshot.",
    ),
})
