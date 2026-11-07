import z from "zod"

export const externalOrderEventTypes = z.enum([
  "orderCreated",
  "paymentReceived",
  "statusChanged",
  "itemStatusChanged",
])
export type ExternalOrderEventType = z.infer<typeof externalOrderEventTypes>
