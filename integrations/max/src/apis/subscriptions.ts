import { MAX_UPDATE_TYPES } from "../constants"
import { createMaxClient } from "../lib/http-client"

export const subscribeWebhook = async (props: {
  token: string
  url: string
  secret: string
}) =>
  await createMaxClient(props.token).post("subscriptions", {
    json: {
      url: props.url,
      update_types: MAX_UPDATE_TYPES,
      secret: props.secret,
    },
  })

export const unsubscribeWebhook = async (props: {
  token: string
  url: string
}) =>
  await createMaxClient(props.token).delete("subscriptions", {
    searchParams: { url: props.url },
  })
