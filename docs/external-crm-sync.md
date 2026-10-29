# External CRM sync

The external CRM API links an external customer id to one ChatbotX contact and stores a durable order snapshot plus every delivered order event. The first source is `gkamion`. Website/server sync calls use a workspace API token with the `ecommerce` scope and are workspace-isolated. Hermes' MCP token needs `ecommerce` to resolve or link that identity, plus `contacts` to add CRM notes or update contact fields; the existing handover operation also needs `inbox`.

## Sync a customer

```http
POST /api/v1/external-crm/customers/sync
Authorization: Bearer <workspace-token>
Content-Type: application/json

{"customer":{"externalCustomerId":"12345","firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","phoneNumber":"+79990000000"}}
```

The operation first resolves the saved external id. On first contact, it links an existing contact only when the supplied email/phone values point to exactly one contact. If they point to different contacts or either value is ambiguous, the request fails with `validation`; it never merges contacts. If no contact matches, at least one of email or phone is required to create a standalone contact without an inbox or conversation. Later syncs update only fields included in the request.

## Record an order event

```http
POST /api/v1/external-crm/orders/events
Authorization: Bearer <workspace-token>
Content-Type: application/json

{"eventId":"order-778:status:3","externalCustomerId":"12345","externalOrderId":"778","eventType":"statusChanged","status":"ready_for_pickup","occurredAt":"2026-10-29T10:00:00.000Z","orderData":{"itemSummary":"Brake pads × 2","amount":12000,"currency":"RUB","paymentStatus":"paid","deliveryMethod":"pickup"}}
```

`eventId` must be stable for a logical event and reused for every retry. A repeated event returns `duplicate: true` and has no additional effect. The current order state advances only when `occurredAt` is not older than the stored event time; all unique events remain in history. If a customer is not linked yet, pass a `customer` object with email or phone in the event so contact linking and event handling can complete. Event/order records retain only the whitelisted `orderData` fields, not the caller's full payload.

## Read data

- `GET /api/v1/external-crm/customers/orders?externalCustomerId=...` returns the linked contact id and current orders.
- `GET /api/v1/external-crm/orders/history?externalOrderId=...` returns the latest snapshot and the full event history.
- Hermes can use `externalCrm.getCustomer` or `externalCrm.getOrderHistory` through MCP. Use the returned `contactId` with `contacts.createNote` or `contacts.setCustomField` to record a VIN or a finding. Treat a failed write as unrecorded.

## Delivery and operations

The sender must retry 5xx/timeouts using the same event id, and must not retry 4xx validation/identity errors without correcting the data. Keep the workspace token server-side, grant only `ecommerce`, and never place it in browser code or logs. The endpoint is synchronous: it commits the order event before returning success, so a successful response is safe to acknowledge at the sender. Order snapshots and event history are retained with the workspace until the workspace is deleted.

The website's order-processing backend is outside the available source repositories. Configure its server-side event producer (or the existing trusted automation that receives its events) to call these endpoints; do not send credentials or order events from browser JavaScript.
