import { stepTypes } from "../../steps/step-action"
import { defineChannelFlowPolicy } from "./define"
// ZZAP chat is plain text: buttons and quick replies are sent as a numbered
// list, images and files as links.

export const zzapFlowPolicy = defineChannelFlowPolicy({
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
