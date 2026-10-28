export const canMutateChat = (props: {
  isBlocked: boolean
  isSupportSession: boolean
  hasRemovedPeer?: boolean
}) =>
  !props.isBlocked && !props.isSupportSession && !props.hasRemovedPeer
