import { z } from "zod"
import type { DromDeal, DromImage, DromListing } from "../parse"

const imageSchema = z.object({
  url: z.string(),
  origUrl: z.string(),
}) satisfies z.ZodType<DromImage>

const listingSchema = z.object({
  title: z.string(),
  url: z.string().nullable(),
  price: z.number().nullable(),
}) satisfies z.ZodType<DromListing>

const dealSchema = z.object({
  dealId: z.string().nullable(),
  orderUrl: z.string(),
  buyerName: z.string(),
  phone: z.string(),
  email: z.string(),
  city: z.string(),
  deliveryMethod: z.string(),
  pickupAddress: z.string(),
  items: z.array(
    z.object({
      title: z.string(),
      price: z.number().nullable(),
      qty: z.number(),
      url: z.string(),
      annotation: z.string(),
    }),
  ),
}) satisfies z.ZodType<DromDeal>

/** One buyer message found by `pollDrom`, the `incomingMessage` payload. */
export const dromInboundEventSchema = z.object({
  kind: z.literal("message"),
  sourceId: z.string().min(1),
  dialogId: z.string().min(1),
  messageId: z.string().min(1),
  interlocutor: z.string(),
  text: z.string(),
  images: z.array(imageSchema),
  isDealSystem: z.boolean(),
  listing: listingSchema.nullable(),
  deal: dealSchema.nullable(),
})

export type DromInboundEvent = z.infer<typeof dromInboundEventSchema>

export const parseDromEvent = (payload: unknown): DromInboundEvent | null => {
  const parsed = dromInboundEventSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}
