import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"

export const createAdminUserRequest = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().trim(),
})
export type CreateAdminUserRequest = z.infer<typeof createAdminUserRequest>

export const resetAdminUserPasswordRequest = z.object({
  userId: zodBigintAsString(),
})
