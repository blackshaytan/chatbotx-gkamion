import type { DatabaseClient } from "@chatbotx.io/database/client"
import { channelTypes } from "@chatbotx.io/database/partials"
import { inboxRepository } from "@chatbotx.io/database/repositories"
import { ChatbotXException } from "../errors"
import {
  hasWorkspacePermission,
  type PermissionsInput,
} from "../workspace-member/permissions"
import { isWorkspaceAdminMember } from "../workspace-member/predicates"
import { workspaceMemberService } from "../workspace-member/service"

export type SmtpViewer = { userId: string; permissions: PermissionsInput }

/**
 * ContactInbox ids whose inbox is hidden from the viewer. Pure: the caller
 * supplies the contact's ContactInbox rows and the precomputed hidden inbox ids.
 */
export const hiddenContactInboxIds = (
  contactInboxes: readonly { id: string; inboxId: string }[],
  hiddenInboxIds: readonly string[] | undefined,
): string[] => {
  if (!hiddenInboxIds?.length) {
    return []
  }
  const hidden = new Set(hiddenInboxIds)
  return contactInboxes
    .filter((contactInbox) => hidden.has(contactInbox.inboxId))
    .map((contactInbox) => contactInbox.id)
}

export const smtpOwnershipService = {
  /**
   * Personal SMTP inbox ids the viewer must not see. A superAdmin sees all;
   * every other member (including one missing the flag) sees only inboxes
   * they own.
   */
  async listHiddenInboxIdsForMember({
    workspaceId,
    viewer,
  }: {
    workspaceId: string
    viewer: SmtpViewer
  }): Promise<string[]> {
    if (hasWorkspacePermission(viewer.permissions, "superAdmin")) {
      return []
    }
    const personalInboxes = await inboxRepository.listPersonalSmtpInboxes({
      workspaceId,
    })
    return personalInboxes
      .filter((inbox) => inbox.ownerUserId !== viewer.userId)
      .map((inbox) => inbox.id)
  },

  /**
   * Users who receive realtime events and pushes for a personal mailbox:
   * its owner plus every workspace admin, deduplicated. Resolves to null for
   * a shared, non-SMTP, or foreign-workspace inbox.
   */
  async resolveAudienceUserIds({
    workspaceId,
    inboxId,
  }: {
    workspaceId: string
    inboxId: string
  }): Promise<string[] | null> {
    const inbox = await inboxRepository.findById({ id: inboxId })
    if (!inbox || inbox.workspaceId !== workspaceId) {
      return null
    }
    if (inbox.channel !== channelTypes.enum.smtp || !inbox.ownerUserId) {
      return null
    }
    const members = await workspaceMemberService.listByWorkspaceId({
      workspaceId,
    })
    const adminUserIds = members
      .filter((member) => isWorkspaceAdminMember(member))
      .map((member) => member.userId)
    return Array.from(new Set([inbox.ownerUserId, ...adminUserIds]))
  },

  /**
   * Sets or clears the personal owner of an SMTP inbox. A non-null owner must
   * be a member of the same workspace.
   */
  async setOwner({
    workspaceId,
    inboxId,
    ownerUserId,
    tx,
  }: {
    workspaceId: string
    inboxId: string
    ownerUserId: string | null
    tx?: DatabaseClient
  }): Promise<void> {
    const inbox = await inboxRepository.findById({ id: inboxId, tx })
    if (!inbox || inbox.workspaceId !== workspaceId) {
      throw new ChatbotXException(
        "Inbox not found",
        "smtpOwnerInboxNotFound",
        404,
      )
    }
    if (ownerUserId !== null) {
      if (inbox.channel !== channelTypes.enum.smtp) {
        throw new ChatbotXException(
          "Only SMTP inboxes can have an owner",
          "smtpOwnerInvalidChannel",
          400,
        )
      }
      const membership = await workspaceMemberService.findMembership({
        tx,
        workspaceId,
        userId: ownerUserId,
      })
      if (!membership) {
        throw new ChatbotXException(
          "Owner must be a workspace member",
          "smtpOwnerNotMember",
          400,
        )
      }
    }
    await inboxRepository.updateOwner({
      workspaceId,
      inboxId,
      ownerUserId,
      tx,
    })
  },

  /**
   * Releases every personal mailbox a removed member owned. Member removal
   * calls the repository directly to avoid a circular import with this module.
   */
  async clearOwnerForUser({
    workspaceId,
    userId,
    tx,
  }: {
    workspaceId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<void> {
    await inboxRepository.clearOwnerForUser({ workspaceId, userId, tx })
  },
}
