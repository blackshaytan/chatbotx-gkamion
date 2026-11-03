import {
  and,
  type DatabaseClient,
  db,
  inArray,
  isNotNull,
  isNull,
} from "@chatbotx.io/database/client"
import { contactModel, contactNoteModel } from "@chatbotx.io/database/schema"
import { invalidateCacheByTags } from "@chatbotx.io/redis"
import { createId } from "@chatbotx.io/utils"

import { normalizePhoneToE164 } from "../contact/phone"
import { ChatbotXException, notFoundException } from "../errors"
import { workspaceService } from "../workspace/service"

type AiCallOptOutSource = "clientCall" | "clientChat" | "manager"

type SetAiCallOptOutInput = {
  workspaceId: string
  contactId?: string
  phone?: string
  source: AiCallOptOutSource
  reason?: string
  actorUserId?: string | null
}

type ClearAiCallOptOutInput = {
  workspaceId: string
  contactId: string
  actorUserId: string
}

const setNote = (reason: string | undefined, noPhone: boolean) => {
  const quote = reason ? `: «${reason.slice(0, 500)}»` : ""
  const tail = noPhone
    ? ". У контакта нет телефона — звонки не заблокированы, пока номер не появится"
    : ""
  return `Клиент попросил не звонить${quote}${tail}`
}

const CLEAR_NOTE_TEXT = "Менеджер снял запрет на звонки робота"

const loadWorkspaceCountry = async (workspaceId: string) => {
  const workspace = await workspaceService.find({
    where: { id: workspaceId },
  })
  if (!workspace) {
    throw notFoundException("Workspace not found")
  }
  return workspace.targetCountry
}

const findContactById = async (
  tx: DatabaseClient,
  workspaceId: string,
  contactId: string,
) => {
  const contact = await tx.query.contactModel.findFirst({
    where: { id: contactId, workspaceId },
    columns: { id: true, phoneNumber: true },
  })
  if (!contact) {
    throw notFoundException("Contact not found")
  }
  return contact
}

const findContactsByPhone = async (
  tx: DatabaseClient,
  workspaceId: string,
  phoneNumber: string,
) => {
  const contacts = await tx.query.contactModel.findMany({
    where: { workspaceId, phoneNumber },
    columns: { id: true },
  })
  return contacts.map((contact) => contact.id)
}

const invalidateContactCache = async (contactIds: string[]) => {
  const tags = contactIds.flatMap((id) => [
    `contacts:${id}`,
    `contacts:${id}:contact-notes`,
  ])
  await invalidateCacheByTags(tags)
}

export const voiceAgentService = {
  async setAiCallOptOut(input: SetAiCallOptOutInput) {
    if (!(input.contactId || input.phone)) {
      throw new ChatbotXException(
        "Contact id or phone is required",
        "invalidRequest",
        400,
      )
    }

    const targetCountry = await loadWorkspaceCountry(input.workspaceId)

    const { contactIds, alreadySet } = await db.transaction(async (tx) => {
      let phoneNumber: string | null = null
      let contactIds: string[] = []
      let addressedContactId: string | null = null

      if (input.contactId) {
        const contact = await findContactById(
          tx,
          input.workspaceId,
          input.contactId,
        )
        addressedContactId = contact.id
        if (input.phone) {
          phoneNumber = normalizePhoneToE164(input.phone, targetCountry)
          if (!phoneNumber) {
            throw new ChatbotXException(
              "Phone is invalid",
              "invalidRequest",
              400,
            )
          }
        } else {
          phoneNumber = contact.phoneNumber
        }
      } else if (input.phone) {
        phoneNumber = normalizePhoneToE164(input.phone, targetCountry)
        if (!phoneNumber) {
          throw new ChatbotXException("Phone is invalid", "invalidRequest", 400)
        }
      }

      if (input.contactId) {
        if (phoneNumber) {
          contactIds = await findContactsByPhone(
            tx,
            input.workspaceId,
            phoneNumber,
          )
          if (contactIds.length === 0) {
            contactIds = [addressedContactId as string]
          }
        } else {
          contactIds = [addressedContactId as string]
        }
      } else if (phoneNumber) {
        contactIds = await findContactsByPhone(
          tx,
          input.workspaceId,
          phoneNumber,
        )
        if (contactIds.length === 0) {
          const newContactId = createId()
          await tx.insert(contactModel).values({
            id: newContactId,
            workspaceId: input.workspaceId,
            phoneNumber,
          })
          contactIds = [newContactId]
        }
      }

      const updated = await tx
        .update(contactModel)
        .set({
          aiCallOptOutAt: new Date(),
          aiCallOptOutSource: input.source,
          aiCallOptOutReason: input.reason?.slice(0, 500) ?? null,
        })
        .where(
          and(
            inArray(contactModel.id, contactIds),
            isNull(contactModel.aiCallOptOutAt),
          ),
        )
        .returning({ id: contactModel.id })

      const updatedIds = updated.map((contact) => contact.id)

      const alreadySet = updatedIds.length === 0

      if (updatedIds.length > 0) {
        await tx.insert(contactNoteModel).values(
          updatedIds.map((contactId) => ({
            id: createId(),
            contactId,
            text: setNote(input.reason, !phoneNumber),
            createdById: input.actorUserId ?? null,
          })),
        )
      }

      return { contactIds, alreadySet }
    })

    await invalidateContactCache(contactIds)

    return { contactIds, alreadySet }
  },

  async clearAiCallOptOut(input: ClearAiCallOptOutInput) {
    await loadWorkspaceCountry(input.workspaceId)

    const { contactIds } = await db.transaction(async (tx) => {
      const contact = await findContactById(
        tx,
        input.workspaceId,
        input.contactId,
      )

      let contactIds: string[]
      if (contact.phoneNumber) {
        contactIds = await findContactsByPhone(
          tx,
          input.workspaceId,
          contact.phoneNumber,
        )
      } else {
        contactIds = [contact.id]
      }

      const updated = await tx
        .update(contactModel)
        .set({
          aiCallOptOutAt: null,
          aiCallOptOutSource: null,
          aiCallOptOutReason: null,
        })
        .where(
          and(
            inArray(contactModel.id, contactIds),
            isNotNull(contactModel.aiCallOptOutAt),
          ),
        )
        .returning({ id: contactModel.id })

      const updatedIds = updated.map((contact) => contact.id)

      if (updatedIds.length > 0) {
        await tx.insert(contactNoteModel).values(
          updatedIds.map((contactId) => ({
            id: createId(),
            contactId,
            text: CLEAR_NOTE_TEXT,
            createdById: input.actorUserId,
          })),
        )
      }

      return { contactIds }
    })

    await invalidateContactCache(contactIds)

    return { contactIds }
  },
}
