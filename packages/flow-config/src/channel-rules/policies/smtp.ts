import { defineChannelFlowPolicy } from "./define"
// Inbox replies and inbound mail use the channel message handlers. The
// dedicated `email` step (a worker action) is still how a flow authors a
// designed email. Keeping `supported` empty hides sendText/sendImage/etc.
// from the editor's SMTP menu so a flow does not grow a second, plainer
// email path next to that step.

export const smtpFlowPolicy = defineChannelFlowPolicy({
  limits: {
    buttonCount: 3,
    buttonLabel: 20,
    text: 6000,
  },
})
