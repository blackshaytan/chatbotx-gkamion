import { contactService } from "@chatbotx.io/business"
import { z } from "zod"
import { possibleErrorsOnFindingResource } from "@/lib/orpc/orpc-error-helper"
import { publicContactIdentifier } from "@/lib/public-api/contact-identifier"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import { resolveGkamionCabinetLinkForContact } from "../../lib/gkamion-cabinet"
import { gkamionCabinetLinkPublicResponse } from "../../schema/public/cabinet-link"

const workspaceTokenAuthAPI = workspaceTokenAuthAPIForScope("contacts")

export const contactsCabinetLinkPublicRouter = {
  getCabinetLink: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/contacts/{identifier}/cabinet-link",
      summary: "Get gKamion customer cabinet link",
      description:
        'Returns the gKamion cabinet URL (`https://admin.gkamion.ru/customers/{id}`). Uses `gkamion_customer_id` when `gkamion_verified` is phone, email, or order_history; otherwise the gKamion customer already stored on the contact\'s orders, which is then saved as `gkamion_verified=order_history`; otherwise a unique phone or email match. Returns `{status:"unavailable"}` when the integration is not configured or no identifier remains, and `{status:"not_found"}` when that customer does not match. Resolve the contact with `contacts.get` first.',
      tags: ["Contacts"],
    })
    .input(
      z.object({
        identifier: publicContactIdentifier,
      }),
    )
    .output(gkamionCabinetLinkPublicResponse)
    .errors(possibleErrorsOnFindingResource)
    .handler(async ({ context, input }) => {
      const workspaceId = context.workspace.id
      const contactId = await contactService.resolveIdByIdentifier({
        identifier: input.identifier,
        workspaceId,
      })
      return await resolveGkamionCabinetLinkForContact({
        workspaceId,
        contactId,
      })
    }),
}
