import { z } from "zod"

export const gkamionCabinetLinkPublicResponse = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    customerId: z
      .string()
      .describe("gKamion customer id used in the cabinet URL."),
    url: z
      .string()
      .describe(
        "Absolute URL of the customer cabinet page on admin.gkamion.ru.",
      ),
  }),
  z.object({
    status: z.literal("not_found"),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.enum(["not_configured", "missing_identifiers"]),
  }),
])

export type GkamionCabinetLinkPublicResponse = z.infer<
  typeof gkamionCabinetLinkPublicResponse
>
