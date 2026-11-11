import {
  type SendOrderNotificationStepSchema,
  sendOrderNotificationStepDefaultFn,
  sendOrderNotificationStepSchema,
} from "@chatbotx.io/flow-config"
import type { StepDefinition } from "../definition"
import SendOrderNotificationStepEditor from "./editor"
import SendOrderNotificationStepViewer from "./viewer"

export const sendOrderNotificationStep: StepDefinition<SendOrderNotificationStepSchema> =
  {
    editor: SendOrderNotificationStepEditor,
    viewer: SendOrderNotificationStepViewer,
    validator: sendOrderNotificationStepSchema,
    defaultFn: sendOrderNotificationStepDefaultFn,
  }
