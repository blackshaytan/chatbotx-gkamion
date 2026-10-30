import { contactService, externalCrmService } from "@chatbotx.io/business"
import { z } from "zod"
import { possibleErrorsOnFindingResource } from "@/lib/orpc/orpc-error-helper"
import { publicContactIdentifier } from "@/lib/public-api/contact-identifier"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import { listContactOrdersResponse } from "../../schema/contact-orders"

const workspaceTokenAuthAPI = workspaceTokenAuthAPIForScope("contacts")

export const contactsOrdersPublicRouter = {
  listOrders: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/contacts/{identifier}/orders",
      summary: "List contact orders",
      description:
        "Returns GKamion orders linked to contact: status, amount, items, delivery, and payment. Resolve contact with `contacts.get` first.",
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
      return {
        data: await externalCrmService.listOrdersForContact({
          workspaceId,
          contactId,
        }),
      }
    }),
}
