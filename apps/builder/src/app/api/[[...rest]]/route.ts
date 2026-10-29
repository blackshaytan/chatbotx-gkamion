import { logger } from "@/lib/log"
import { createOpenAPIHandler } from "@/lib/orpc/handlers"
import { publicRouter } from "@/routers/public"
import "@/polyfill"

// Runtime boundary intentionally matches the spec boundary: this handler
// only ever serves `publicRouter` (workspace-token / channel-token auth),
// the same router `/api/spec.json` documents. Private, session-authed
// procedures live on the full router and are reachable only via /rpc — a
// procedure absent from publicRouter now 404s here instead of silently
// answering to a session cookie. See __tests__/public-router-boundary.test.ts.
const openAPIHandler = createOpenAPIHandler(publicRouter, {
  title: "Public API",
  logLabel: "OpenAPI handler",
})

const externalCustomerSyncPath = "/api/v1/external-crm/customers/sync"

function describeJsonShape(value: unknown, depth = 0): unknown {
  if (value === null) {
    return "null"
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value
        .slice(0, 2)
        .map((item) => describeJsonShape(item, depth + 1)),
      ...(value.length > 2 && { remainingItems: value.length - 2 }),
    }
  }
  if (typeof value !== "object") {
    return typeof value
  }
  if (depth >= 5) {
    return "object"
  }

  const entries = Object.entries(value)
  const shape = Object.fromEntries(
    entries
      .slice(0, 256)
      .map(([key, nested]) => [key, describeJsonShape(nested, depth + 1)]),
  )
  if (entries.length > 256) {
    shape.__additionalKeys = entries.length - 256
  }
  return shape
}

async function logExternalCustomerSyncShape(request: Request) {
  if (
    request.method !== "POST" ||
    new URL(request.url).pathname !== externalCustomerSyncPath
  ) {
    return
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (contentLength > 64 * 1024) {
    logger.info(
      { path: externalCustomerSyncPath, bodyTooLarge: true },
      "External CRM request shape",
    )
    return
  }

  try {
    const payload: unknown = await request.clone().json()
    logger.info(
      { path: externalCustomerSyncPath, shape: describeJsonShape(payload) },
      "External CRM request shape",
    )
  } catch {
    logger.info(
      { path: externalCustomerSyncPath, invalidJson: true },
      "External CRM request shape",
    )
  }
}

async function handleRequest(request: Request) {
  await logExternalCustomerSyncShape(request)
  const { response } = await openAPIHandler.handle(request, {
    prefix: "/api",
    context: { headers: request.headers, url: request.url },
  })
  return response ?? new Response("Not found", { status: 404 })
}

export const GET = handleRequest
export const POST = handleRequest
export const PUT = handleRequest
export const PATCH = handleRequest
export const DELETE = handleRequest
