import z from "zod"

export const externalOrderEventTypes = z.enum([
  "orderCreated",
  "paymentReceived",
  "statusChanged",
])
export type ExternalOrderEventType = z.infer<typeof externalOrderEventTypes>
