# External CRM sync

The external CRM API links an external customer id to one ChatbotX contact and stores a durable order snapshot plus every delivered order event. The first source is `gkamion`. Website/server sync calls use a workspace API token with the `ecommerce` scope and are workspace-isolated. Hermes' MCP token needs `ecommerce` to resolve or link that identity, plus `contacts` to add CRM notes or update contact fields; the existing handover operation also needs `inbox`.

## Sync a customer

```http
POST /api/v1/external-crm/customers/sync
Authorization: Bearer <workspace-token>
Content-Type: application/json

{"customer":{"externalCustomerId":"12345","firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","phoneNumber":"+79990000000"}}
```

The same route accepts the GKamion customer record the website already posts: `{ "customer": { "id", "name", "family_name", "second_name", "email", "contact" } }`. `id` is the external customer id. `family_name` is the surname, `name` is the given name, and `second_name` is the patronymic appended to the given name. A phone is read from `contact.clean_cell_phone`, then `contact.clean_phone`, `contact.cell_phone`, and `contact.phone`. Hash placeholders such as `####` and the labels «Клиент» and «Покупатель» are dropped. When the surname is empty and `name` contains several words, the first word is the surname and the rest is the given name. Account secrets in that record (password, salt, tokens) are discarded and never stored.

The operation first resolves the saved external id. On first contact, it links an existing contact only when the supplied email/phone values point to exactly one contact. If they point to different contacts or either value is ambiguous, the request fails with `validation`; it never merges contacts. If no contact matches, at least one of email or phone is required to create a standalone contact without an inbox or conversation. Later syncs update only fields included in the request.

## Record an order event

```http
POST /api/v1/external-crm/orders/events
Authorization: Bearer <workspace-token>
Content-Type: application/json

{"eventId":"order-778:status:21:01HXYZ","externalCustomerId":"12345","externalOrderId":"778","eventType":"statusChanged","status":"ready_for_pickup","statusId":21,"occurredAt":"2026-10-29T10:00:00.000Z","orderData":{"itemSummary":"Brake pads × 2","amount":12000,"currency":"RUB","paymentStatus":"paid","deliveryMethod":"pickup","hasDebt":false,"orderNumber":"778","phone":"+79990000000","email":"ada@example.com","billUrl":"https://pay.example/778"}}
```

`eventType` is `orderCreated`, `paymentReceived`, `statusChanged`, or `itemStatusChanged`. An item event also sends `externalOrderItemId`. `statusId` is the numeric GKamion status. `orderCreated` and `statusChanged` start published flows subscribed to that order status. `itemStatusChanged` starts flows subscribed to that item status. `paymentReceived` is stored and does not start a notification flow.

`eventId` is stable across retries of the same change and new on each real entry into a status. A repeated event whose notification runs already exist returns `duplicate: true` and does not send again. If the event was stored but the runs were not created, the same `eventId` only creates the runs. An `occurredAt` older than an already accepted event of that order (or of that item) is kept in history and starts nothing.

The contact card keeps the short snapshot (`itemSummary`, `amount`, `currency`, `paymentStatus`, `deliveryMethod`). The event row keeps the notification package as sent: `deliveryMethod` (`pickup` or `delivery`), `hasDebt`, `amount`, `itemSummary`, `billUrl`, `orderNumber`, `phone`, and `email`. ChatbotX does not compute those fields. A flow check whose field is missing does not match, so no message is sent. An empty template value leaves an empty place and the message still sends.

If the customer is not linked and the event has neither phone nor email, the request is rejected and nothing is stored. Phone and email that point at different people, or at several contacts, are rejected and not merged. Pass a `customer` object or put `phone` and `email` in `orderData`.

The operator writes the text, the status numbers, the checks, and the wait in a ChatbotX flow. One notification is one published flow. The send step tries MAX, Telegram, ZZAP, DROM, then email, and stops on the first accepted dialog. A timeout stops the cascade. The dashboard mailer is not part of this path; turn off the matching n8n mail call once the published flow is sending.

## Read data

- `GET /api/v1/external-crm/customers/orders?externalCustomerId=...` returns the linked contact id and current orders.
- `GET /api/v1/external-crm/orders/history?externalOrderId=...` returns the latest snapshot and the full event history.
- Hermes can use `externalCrm.getCustomer` or `externalCrm.getOrderHistory` through MCP. Use the returned `contactId` with `contacts.createNote` or `contacts.setCustomField` to record a VIN or a finding. Treat a failed write as unrecorded.

## Delivery and operations

The sender must retry 5xx/timeouts using the same event id, and must not retry 4xx validation/identity errors without correcting the data. Keep the workspace token server-side, grant only `ecommerce`, and never place it in browser code or logs. The endpoint is synchronous: it commits the order event before returning success, so a successful response is safe to acknowledge at the sender. Order snapshots and event history are retained with the workspace until the workspace is deleted.

The website's order-processing backend is outside the available source repositories. Configure its server-side event producer (or the existing trusted automation that receives its events) to call these endpoints; do not send credentials or order events from browser JavaScript.
