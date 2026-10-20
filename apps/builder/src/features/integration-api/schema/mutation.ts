import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"

/** The form sends `""` for an empty optional field; that means "no callback URL". */
const callbackUrlField = z
  .union([z.url(), z.literal("")])
  .nullish()
  .transform((value) => (value === "" ? null : value))

export const createApiRequest = z.object({
  name: z.string().min(1).max(40),
  workspaceId: zodBigintAsString().nullish(),
  callbackUrl: callbackUrlField,
})
export type CreateApiRequest = z.infer<typeof createApiRequest>

export const updateApiRequest = z.object({
  name: z.string().min(1).max(40).optional(),
  callbackUrl: callbackUrlField,
})
export type UpdateApiRequest = z.infer<typeof updateApiRequest>
