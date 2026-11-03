import { z } from "zod"

export const aiCallOptOutSourceSchema = z.enum([
  "clientCall",
  "clientChat",
  "manager",
])

export type AiCallOptOutSource = z.infer<typeof aiCallOptOutSourceSchema>
