export type PostConnectStep = "pause" | "subscribe"

export const resolvePostConnectStep = (provider: {
  startsPaused?: boolean
}): PostConnectStep => (provider.startsPaused ? "pause" : "subscribe")
