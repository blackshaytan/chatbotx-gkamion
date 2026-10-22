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
        'Looks up the contact in gKamion Admin by phone or email and returns the cabinet URL (`https://admin.gkamion.ru/customers/{id}`). Requires the contact to have a phone number and/or email. Returns `{status:"unavailable"}` when the integration is not configured or identifiers are missing, and `{status:"not_found"}` when no customer matches. Resolve the contact with `contacts.get` first.',
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
