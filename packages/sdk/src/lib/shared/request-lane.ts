const lanes = new Map<string, Promise<void>>()

/**
 * Serialises requests of one key (an API key, a seller session): resolves
 * with a `release` callback once the previous request of `key` was released
 * at least `minIntervalMs` ago. Call `release` when the request finished
 * (also on failure). Process-local.
 */
export const acquireRequestSlot = async (
  key: string,
  minIntervalMs: number,
): Promise<() => void> => {
  const previous = lanes.get(key) ?? Promise.resolve()
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const lane = released.then(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, minIntervalMs)
      }),
  )
  lanes.set(key, lane)
  lane.then(() => {
    if (lanes.get(key) === lane) {
      lanes.delete(key)
    }
  })
  await previous
  return release
}
