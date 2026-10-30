import { externalCrmService } from "@chatbotx.io/business"
import { notFoundException } from "@chatbotx.io/business/errors"
import { zodBigintAsString } from "@chatbotx.io/utils"
import z from "zod"
import { withWorkspaceIdSchema } from "@/features/workspaces/schema/resource"
import { workspaceAuthorizedMidddleware } from "@/middlewares/auth"
import { authorizedAPI } from "@/orpc"
import { resolveGkamionCabinetLinkForContact } from "../lib/gkamion-cabinet"
import {
  buildContactPermissionScope,
  requireContactAccessForMember,
  requireContactPermissionScope,
  requireContactPermissionScopeForMember,
} from "../permissions"
import { getContact } from "../queries/get-contact.query"
import { getExportFile } from "../queries/get-export-file.query"
import {
  countContactInboxes,
  listAudienceInboxesPreview,
} from "../queries/list-contact-inboxes.queries"
import { countContacts, listContacts } from "../queries/list-contacts.queries"
import { getExportFileRequest, getExportFileResponse } from "../schema/action"
import { listContactOrdersResponse } from "../schema/contact-orders"
import { gkamionCabinetLinkPublicResponse } from "../schema/public/cabinet-link"
import {
  getContactRequest,
  getContactResponse,
  listContactInboxesAudiencePreviewRequest,
  listContactInboxesAudiencePreviewResponse,
  listContactsRequest,
  listContactsTableResponse,
} from "../schema/query"

export const contactsAuthenticatedAPI = {
  getContactAuthenticatedAPI: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/contacts/{contactId}",
      summary: "Get contact",
      tags: ["Contacts"],
    })
    .input(getContactRequest)
    .output(getContactResponse)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ input, context }) => {
      const { workspaceId, contactId } = input
      const scope = buildContactPermissionScope({
        permissions: context.workspaceMember.permissions,
        userId: context.user.id,
      })
      if (!scope) {
        throw notFoundException("Contact not found")
      }

      return await getContact({ workspaceId, contactId }, scope)
    }),

  listContactsByPOSTAuthenticatedAPI: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/contacts/list",
      summary: "List contacts using POST request",
      tags: ["Contacts"],
    })
    .input(listContactsRequest.and(withWorkspaceIdSchema))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(listContactsTableResponse)
    .handler(async ({ input, context }) => {
      const scope = requireContactPermissionScopeForMember({
        permissions: context.workspaceMember.permissions,
        userId: context.user.id,
      })
      return await listContacts(input, scope)
    }),

  countContactsAuthenticatedAPI: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/contacts/count",
      summary: "Count contacts",
      tags: ["Contacts"],
    })
    .input(listContactsRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(z.object({ total: z.number() }))
    .handler(async ({ input, context }) => {
      const scope = requireContactPermissionScopeForMember({
        permissions: context.workspaceMember.permissions,
        userId: context.user.id,
      })
      return await countContacts(input, scope)
    }),

  countContactInboxesAuthenticatedAPI: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/contacts/inboxes/count",
      summary: "Count contact inboxes",
      tags: ["Contacts"],
    })
    .input(listContactsRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(z.object({ total: z.number() }))
    .handler(async ({ input }) => {
      const accessScope = await requireContactPermissionScope(input.workspaceId)
      return await countContactInboxes(input, accessScope)
    }),

  listContactInboxesAudiencePreviewAuthenticatedAPI: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/contacts/inboxes/audience-preview",
      summary: "List audience contact inboxes preview",
      tags: ["Contacts"],
    })
    .input(listContactInboxesAudiencePreviewRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(listContactInboxesAudiencePreviewResponse)
    .handler(async ({ input }) => {
      const accessScope = await requireContactPermissionScope(input.workspaceId)
      return await listAudienceInboxesPreview(input, accessScope)
    }),

  getExportFileAuthenticatedAPI: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/contacts/export-files/{fileId}",
      summary: "Get contact export file status",
      tags: ["Contacts"],
    })
    .input(getExportFileRequest)
    .output(getExportFileResponse)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ input }) => {
      await requireContactPermissionScope(input.workspaceId)
      return await getExportFile(input)
    }),

  getGkamionCabinetLinkAuthenticatedAPI: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/contacts/{contactId}/cabinet-link",
      summary: "Get gKamion customer cabinet link",
      tags: ["Contacts"],
    })
    .input(
      z.object({
        workspaceId: zodBigintAsString(),
        contactId: zodBigintAsString(),
      }),
    )
    .output(gkamionCabinetLinkPublicResponse)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ input, context }) => {
      const accessScope = buildContactPermissionScope({
        permissions: context.workspaceMember.permissions,
        userId: context.user.id,
      })
      if (!accessScope) {
        throw notFoundException("Contact not found")
      }
      return await resolveGkamionCabinetLinkForContact({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        accessScope,
      })
    }),

  listContactOrdersAuthenticatedAPI: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/contacts/{contactId}/orders",
      summary: "List contact orders",
      tags: ["Contacts"],
    })
    .input(
      z.object({
        workspaceId: zodBigintAsString(),
        contactId: zodBigintAsString(),
      }),
    )
    .output(listContactOrdersResponse)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ input, context }) => {
      await requireContactAccessForMember({
        permissions: context.workspaceMember.permissions,
        userId: context.user.id,
        workspaceId: input.workspaceId,
        contactId: input.contactId,
      })
      return {
        data: await externalCrmService.listOrdersForContact({
          workspaceId: input.workspaceId,
          contactId: input.contactId,
        }),
      }
    }),
}
