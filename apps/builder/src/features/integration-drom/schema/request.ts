import { z } from "zod"

export const connectDromRequest = z.object({
  secretText: z.string().trim().min(1),
  sellerLogin: z.string().trim().min(1),
})
export type ConnectDromRequest = z.infer<typeof connectDromRequest>

export const setDromEnabledRequest = z.object({
  connectionId: z.string().min(1),
  enabled: z.boolean(),
})
export type SetDromEnabledRequest = z.infer<typeof setDromEnabledRequest>
