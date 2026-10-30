import { externalCrmService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"
import { mcpSpec } from "@/lib/orpc/mcp-annotations"
import {
  possibleErrorsOnFindingResource,
  possibleErrorsOnMutatingResource,
} from "@/lib/orpc/orpc-error-helper"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import {
  getExternalCustomerPublicRequest,
  getExternalCustomerPublicResponse,
  getExternalOrderHistoryPublicResponse,
  recordExternalOrderEventPublicRequest,
  syncExternalCustomerPublicRequest,
} from "../schema/public"

const workspaceTokenAuthAPI = workspaceTokenAuthAPIForScope("ecommerce")

export const externalCrmPublicRouter = {
  syncCustomer: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/external-crm/customers/sync",
      summary: "Sync external customer",
      description:
        "Creates or updates a contact linked to the gkamion customer id, without creating an inbox or conversation. The id comes from the gkamion customer record (for Hermes, use `customer_id` returned by `save_contact`). A posted GKamion customer record is reduced to `id`, `name`, `family_name`, `second_name`, `email`, and `contact` phone/email; password and token fields are ignored. Use `externalCrm.getCustomer` to resolve the linked contact and its order history. A new contact needs an email address or phone number. Existing contacts are linked only when email/phone matching is unambiguous.",
      tags: ["External CRM"],
      spec: mcpSpec({ visibility: "default" }),
    })
    .input(syncExternalCustomerPublicRequest)
    .output(z.object({ contactId: zodBigintAsString(), created: z.boolean() }))
    .errors(possibleErrorsOnMutatingResource)
    .handler(
      async ({ context, input }) =>
        await externalCrmService.syncCustomer({
          workspaceId: context.workspace.id,
          customer: input.customer,
        }),
    ),

  recordOrderEvent: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/external-crm/orders/events",
      summary: "Record external order event",
      description:
        "Records an idempotent gkamion order event and updates the current order snapshot only when the event is at least as recent as the stored state. `externalCustomerId` is the customer's gkamion id; `externalOrderId` comes from the gkamion order. `eventId` must be stable across retries. Sync the customer first with `externalCrm.syncCustomer`, or include `customer` to create/link it when needed. Returns `duplicate: true` when this event was already stored.",
      tags: ["External CRM"],
    })
    .input(recordExternalOrderEventPublicRequest)
    .output(
      z.object({
        duplicate: z.boolean(),
        contactId: zodBigintAsString().optional(),
        orderId: z.string(),
      }),
    )
    .errors(possibleErrorsOnMutatingResource)
    .handler(
      async ({ context, input }) =>
        await externalCrmService.recordOrderEvent({
          workspaceId: context.workspace.id,
          event: input,
        }),
    ),

  getCustomer: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/external-crm/customers/orders",
      summary: "Get external customer and orders",
      description:
        "Resolves a customer by gkamion's id supplied to `externalCrm.syncCustomer` and returns the linked contact id plus that customer's current order snapshots. For Hermes, use the `customer_id` returned by gkamion `save_contact`. Use `contacts_create_note` or `contacts_set_custom_field` with the returned contact id to record an agent finding. Order ids come from `externalCrm.recordOrderEvent`.",
      tags: ["External CRM"],
      spec: mcpSpec({ visibility: "default" }),
    })
    .input(getExternalCustomerPublicRequest)
    .output(getExternalCustomerPublicResponse)
    .errors(possibleErrorsOnFindingResource)
    .handler(
      async ({ context, input }) =>
        await externalCrmService.listCustomerOrders({
          workspaceId: context.workspace.id,
          externalCustomerId: input.externalCustomerId,
        }),
    ),

  getOrderHistory: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/external-crm/orders/history",
      summary: "Get external order history",
      description:
        "Returns the current snapshot and every recorded status/payment event for an order. The order id comes from the external source system and was first sent to `externalCrm.recordOrderEvent`.",
      tags: ["External CRM"],
      spec: mcpSpec({ visibility: "default" }),
    })
    .input(
      z.object({
        externalOrderId: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .describe(
            "GKamion order id first sent to externalCrm.recordOrderEvent.",
          ),
      }),
    )
    .output(getExternalOrderHistoryPublicResponse)
    .errors(possibleErrorsOnFindingResource)
    .handler(
      async ({ context, input }) =>
        await externalCrmService.getOrderHistory({
          workspaceId: context.workspace.id,
          externalOrderId: input.externalOrderId,
        }),
    ),
}
