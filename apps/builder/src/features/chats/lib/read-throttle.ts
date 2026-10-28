export const CHAT_READ_THROTTLE_MS = 2_000

export const canMarkChatRead = (props: {
  isPending: boolean
  isSupportSession: boolean
  lastMarkedAt: number
  now: number
  hasMessage: boolean
}) =>
  props.hasMessage &&
  !props.isPending &&
  !props.isSupportSession &&
  props.now - props.lastMarkedAt >= CHAT_READ_THROTTLE_MS
