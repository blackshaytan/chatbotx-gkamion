import { stepTypes } from "../../steps/step-action"
import { defineChannelFlowPolicy } from "./define"
// DROM chat carries text and photos: buttons and quick replies are sent as a
// numbered list, files as links.

export const dromFlowPolicy = defineChannelFlowPolicy({
  limits: {
    buttonCount: 10,
    buttonLabel: 64,
    text: 4000,
  },
  supported: [
    stepTypes.enum.sendText,
    stepTypes.enum.sendImage,
    stepTypes.enum.sendFile,
    stepTypes.enum.sendQuickReply,
  ],
})
