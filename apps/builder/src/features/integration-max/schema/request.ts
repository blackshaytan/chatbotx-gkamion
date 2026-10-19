import { z } from "zod"

export const connectMaxRequest = z.object({
  botToken: z.string().trim().min(1),
})
export type ConnectMaxRequest = z.infer<typeof connectMaxRequest>

export const setMaxEnabledRequest = z.object({
  connectionId: z.string().min(1),
  enabled: z.boolean(),
})
export type SetMaxEnabledRequest = z.infer<typeof setMaxEnabledRequest>
