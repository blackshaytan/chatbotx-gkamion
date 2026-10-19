import { objectParams } from "../lib/fields"
import { createZzapClient } from "../lib/http-client"
import type { ZzapAuthValue, ZzapThread } from "../schema"

/** Buyer threads of the shop, most recently active first. */
export const listThreads = async (
  auth: ZzapAuthValue,
  input: { page?: number; pageSize?: number } = {},
): Promise<ZzapThread[]> => {
  const result = await createZzapClient(auth).get<{ data?: ZzapThread[] }>(
    "/api/client/v1/messages",
    {
      page: input.page ?? 1,
      page_size: input.pageSize ?? 100,
      ...objectParams(auth),
    },
  )
  return result?.data ?? []
}
