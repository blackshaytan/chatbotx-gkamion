import { pickString } from "../lib/fields"
import { createZzapClient } from "../lib/http-client"
import type { ZzapAuthValue, ZzapBuyer } from "../schema"

type RawRecord = Record<string, unknown>

/** Buyer profile by `user_key` (`GET /user/{key}`). */
export const getBuyer = async (
  auth: ZzapAuthValue,
  userKey: string,
): Promise<ZzapBuyer> => {
  const user = await createZzapClient(auth).get<RawRecord>(
    `/api/client/v1/user/${encodeURIComponent(userKey)}`,
  )
  return {
    name: pickString(user, "class_user", "name_first"),
    phone: pickString(user, "phone1", "phone2", "phone_v2", "phone"),
    email: pickString(user, "email"),
  }
}

/** Buyer contacts recorded on a seller order (`GET /orders/seller/{code}`). */
export const getOrderBuyer = async (
  auth: ZzapAuthValue,
  orderCode: string,
): Promise<ZzapBuyer> => {
  const order = await createZzapClient(auth).get<RawRecord>(
    `/api/client/v1/orders/seller/${encodeURIComponent(orderCode)}`,
  )
  return {
    name: pickString(order, "client_name"),
    phone: pickString(order, "client_phone"),
    email: pickString(order, "client_email"),
  }
}
