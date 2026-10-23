export type NotificationsCreatedPayload = {
  workspaceId: string
  notifications: { id: string; userId: string }[]
}

type NotificationsCreatedListener = (
  payload: NotificationsCreatedPayload,
) => void

const listeners = new Set<NotificationsCreatedListener>()

export const onNotificationsCreated = (
  listener: NotificationsCreatedListener,
): void => {
  listeners.add(listener)
}

export const emitNotificationsCreated = (
  payload: NotificationsCreatedPayload,
): void => {
  for (const listener of listeners) {
    listener(payload)
  }
}

/** @internal vitest isolation */
export const resetNotificationsCreatedListenersForTests = (): void => {
  listeners.clear()
}
