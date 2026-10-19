import { encryptedDataSchema, encryptUtils } from "@chatbotx.io/encryption"
import { type AuthValue, authValueSchema } from "@chatbotx.io/sdk"
import { z } from "zod"

const SEALED_AAD = "connection-auth"

const sealedAuthSchema = z.object({
  authType: z.literal("custom"),
  sealed: encryptedDataSchema,
})
export type SealedAuth = z.infer<typeof sealedAuthSchema>

export const isSealedAuth = (value: unknown): value is SealedAuth =>
  sealedAuthSchema.safeParse(value).success

/** Stores the whole auth object encrypted; the `custom` envelope still satisfies `authValueSchema`. */
export const sealAuth = async (auth: AuthValue): Promise<SealedAuth> => ({
  authType: "custom",
  sealed: await encryptUtils.encryptObject(auth, SEALED_AAD),
})

/** Opens a sealed envelope; plain auth rows of other channels pass through. */
export const openAuth = async (value: unknown): Promise<AuthValue> => {
  const parsed = sealedAuthSchema.safeParse(value)
  if (!parsed.success) {
    return authValueSchema.parse(value)
  }
  return await encryptUtils.decryptObject(
    parsed.data.sealed,
    authValueSchema,
    SEALED_AAD,
  )
}
