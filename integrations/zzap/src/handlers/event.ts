import { z } from "zod"

const zzapBuyerSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
})

/** One buyer message found by `pollZzap`, the `incomingMessage` payload. */
export const zzapInboundEventSchema = z.object({
  kind: z.literal("message"),
  sourceId: z.string().min(1),
  userKey: z.string().min(1),
  userName: z.string(),
  messageDate: z.string().min(1),
  /** Raw ZZAP text — `[img]`/`[file]` tags are still inside. */
  text: z.string(),
  buyer: zzapBuyerSchema.nullable(),
})

export type ZzapInboundEvent = z.infer<typeof zzapInboundEventSchema>

export const parseZzapEvent = (payload: unknown): ZzapInboundEvent | null => {
  const parsed = zzapInboundEventSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}
