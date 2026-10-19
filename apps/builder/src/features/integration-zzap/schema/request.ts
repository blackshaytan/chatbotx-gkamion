import { z } from "zod"

export const connectZzapRequest = z.object({
  secretText: z.string().trim().min(1),
  codeObject: z.string().trim().min(1),
  typeObject: z.string().trim().min(1),
  testMode: z.boolean(),
})
export type ConnectZzapRequest = z.infer<typeof connectZzapRequest>

export const setZzapEnabledRequest = z.object({
  connectionId: z.string().min(1),
  enabled: z.boolean(),
})
export type SetZzapEnabledRequest = z.infer<typeof setZzapEnabledRequest>
