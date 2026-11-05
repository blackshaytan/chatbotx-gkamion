import { receiveMessage } from "./incoming"
import { sendFlowStep, sendMessage } from "./outgoing"

export const messageHandlers = {
  receiveMessage,
  sendMessage,
  sendFlowStep,
}
