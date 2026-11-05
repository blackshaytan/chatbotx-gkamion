import {
  createSelectSchema,
  integrationSmtpModel,
} from "@chatbotx.io/database/schema"
import { z } from "zod"

export const integrationSmtpResource = createSelectSchema(
  integrationSmtpModel,
  {
    id: z.string(),
  },
).pick({
  id: true,
  name: true,
  fromAddress: true,
})
export type IntegrationSmtpResource = z.infer<typeof integrationSmtpResource>

/** Settings the edit form can show. The password stays in `auth` and is never included. */
export type SmtpEditableSettings = IntegrationSmtpResource & {
  provider: string
  host: string
  port: number
  username: string
  receiveEnabled: boolean
  imapHost: string
  imapPort: number | null
}
