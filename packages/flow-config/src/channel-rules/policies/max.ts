import { stepTypes } from "../../steps/step-action"
import { defineChannelFlowPolicy } from "./define"
// MAX Bot API messages are capped at 4,000 characters; longer text is split.

export const maxFlowPolicy = defineChannelFlowPolicy({
  limits: {
    buttonCount: 10,
    buttonLabel: 64,
    text: 4000,
  },
  supported: [
    stepTypes.enum.sendText,
    stepTypes.enum.sendImage,
    stepTypes.enum.sendVideo,
    stepTypes.enum.sendMultipleImages,
    stepTypes.enum.sendAudio,
    stepTypes.enum.sendFile,
    stepTypes.enum.sendGif,
    stepTypes.enum.sendQuickReply,
    stepTypes.enum.sendCarousel,
  ],
})
