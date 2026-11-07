import { createId, zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"
import {
  errorStateDefaultFn,
  errorStateSchema,
  successStateDefaultFn,
  successStateSchema,
} from "../states"
import { stepTypes } from "./step-action"

export const sendOrderNotificationStepSchema = z.object({
  id: zodBigintAsString().describe(
    "Step id (numeric string), unique within the flow.",
  ),
  stepType: z
    .literal(stepTypes.enum.sendOrderNotification)
    .describe('Step type discriminator: "sendOrderNotification".'),
  subject: z
    .enum(["order", "item"])
    .describe(
      "What starts this flow: an order status (`orderCreated` or `statusChanged`) or an item status (`itemStatusChanged`).",
    ),
  statusIds: z
    .array(z.number().int())
    .min(1)
    .max(50)
    .describe(
      "Numeric GKamion status ids. A published flow starts when an order event's statusId is in this list. Get the event from externalCrm.recordOrderEvent.",
    ),
  messengerText: z
    .string()
    .max(4000)
    .describe(
      "Text sent to MAX, Telegram, ZZAP and DROM. Placeholders: {{orderNumber}}, {{itemSummary}}, {{amount}}, {{billUrl}}. An empty value skips those channels.",
    ),
  emailText: z
    .string()
    .max(4000)
    .describe(
      "Text sent by email. Same placeholders as messengerText. An empty value skips email.",
    ),
  emailSubject: z
    .string()
    .max(200)
    .describe(
      "Email subject. Same placeholders as messengerText. Empty uses the order number.",
    ),
  states: z.tuple([successStateSchema, errorStateSchema]),
})
export type SendOrderNotificationStepSchema = z.infer<
  typeof sendOrderNotificationStepSchema
>

export const sendOrderNotificationStepDefaultFn =
  (): SendOrderNotificationStepSchema => ({
    id: createId(),
    stepType: stepTypes.enum.sendOrderNotification,
    subject: "order",
    statusIds: [],
    messengerText: "",
    emailText: "",
    emailSubject: "",
    states: [successStateDefaultFn(), errorStateDefaultFn()],
  })
