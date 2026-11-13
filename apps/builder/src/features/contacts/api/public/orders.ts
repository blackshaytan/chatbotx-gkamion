import { contactService } from "@chatbotx.io/business"
import { z } from "zod"
import { possibleErrorsOnFindingResource } from "@/lib/orpc/orpc-error-helper"
import { publicContactIdentifier } from "@/lib/public-api/contact-identifier"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import { listContactOrdersWithGkamion } from "../../lib/pull-gkamion-contact"
import { listContactOrdersResponse } from "../../schema/contact-orders"

const workspaceTokenAuthAPI = workspaceTokenAuthAPIForScope("contacts")

export const contactsOrdersPublicRouter = {
  listOrders: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/contacts/{identifier}/orders",
      summary: "List contact orders",
      description:
        "Returns the contact's current gKamion orders: status, amount, items, delivery, and payment. The customer is `gkamion_customer_id` when `gkamion_verified` is phone, email, or order_history; otherwise the gKamion customer already stored on the contact's orders; otherwise the contact phone or email is searched. A stored customer is saved as `gkamion_verified=order_history`. Empty first name, last name, phone, and email are filled from that customer and are not overwritten when already set. Issued, cancelled, and supplier-rejected orders are omitted. Resolve the contact with `contacts.get` first. Without gKamion admin credentials, returns the stored external-CRM snapshots.",
      tags: ["Contacts"],
    })
    .input(
      z.object({
        identifier: publicContactIdentifier,
      }),
    )
    .output(listContactOrdersResponse)
    .errors(possibleErrorsOnFindingResource)
    .handler(async ({ context, input }) => {
      const workspaceId = context.workspace.id
      const contactId = await contactService.resolveIdByIdentifier({
        identifier: input.identifier,
        workspaceId,
      })
      return await listContactOrdersWithGkamion({
        workspaceId,
        contactId,
      })
    }),
}
