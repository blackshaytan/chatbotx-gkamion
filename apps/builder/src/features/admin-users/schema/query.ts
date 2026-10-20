import {
  createSearchParamsCache,
  parseAsInteger,
  parseAsString,
} from "nuqs/server"

export const getAdminUsersSearchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(10),
  keyword: parseAsString,
})

export type ListAdminUsersRequest = Awaited<
  ReturnType<typeof getAdminUsersSearchParamsCache.parse>
>
