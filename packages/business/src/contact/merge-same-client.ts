import {
  and,
  type DatabaseClient,
  db,
  eq,
  inArray,
  liftDecompressionLimit,
  or,
  sql,
} from "@chatbotx.io/database/client"
import {
  attachmentModel,
  contactCustomFieldModel,
  contactInboxModel,
  contactModel,
  conversationModel,
  externalAgentConversationStateModel,
  externalCustomerIdentityModel,
  externalOrderModel,
  messageModel,
} from "@chatbotx.io/database/schema"
import { invalidateCacheByTags } from "@chatbotx.io/redis"
import { logger } from "../logger"
import {
  matchingContacts,
  normalizeEmail,
  phoneCandidates,
  pickSurvivor,
  type SameClientIdentity,
} from "./merge-same-client-rules"
import { contactService } from "./service"

const CONVERSATION_TABLES = [
  "FlowRun",
  "Appointment",
  "QuestionnaireSubmission",
  "TaskTarget",
  "ConversationParticipant",
  "WhatsappCall",
  "ContactOnSmartDelay",
  "ContactOnBroadcast",
  "AIConversationEmbedding",
  "AIConversationSource",
  "AnalyticsEmailTopic",
  "AnalyticsConversationEvent",
  "AnalyticsBotMessageEvent",
] as const

const loadIdentityMatches = async (props: {
  workspaceId: string
  phoneNumber?: string | null
  email?: string | null
  tx?: DatabaseClient
}): Promise<SameClientIdentity[]> => {
  const phones = phoneCandidates(props.phoneNumber)
  const email = normalizeEmail(props.email)
  if (phones.length === 0 && !email) {
    return []
  }
  const tx = props.tx ?? db
  const rows = await tx
    .select({
      id: contactModel.id,
      createdAt: contactModel.createdAt,
      phoneNumber: contactModel.phoneNumber,
      email: contactModel.email,
    })
    .from(contactModel)
    .where(
      and(
        eq(contactModel.workspaceId, props.workspaceId),
        or(
          phones.length > 0
            ? inArray(contactModel.phoneNumber, phones)
            : sql`false`,
          email ? sql`lower(${contactModel.email}) = ${email}` : sql`false`,
        ),
      ),
    )
  return matchingContacts(rows, {
    phoneNumber: props.phoneNumber,
    email: props.email,
  })
}

const dedupeConversationParticipants = async (
  tx: DatabaseClient,
  targetConversationId: string,
  duplicateConversationId: string,
) => {
  await tx.execute(sql`
    DELETE FROM "ConversationParticipant" AS duplicate
    USING "ConversationParticipant" AS survivor
    WHERE duplicate."conversationId" = ${duplicateConversationId}
      AND survivor."conversationId" = ${targetConversationId}
      AND duplicate."userId" = survivor."userId"
  `)
}

const moveContactScopedRows = async (
  tx: DatabaseClient,
  survivorContactId: string,
  duplicateContactId: string,
) => {
  await tx.execute(sql`
    DELETE FROM "ContactToTag" AS duplicate
    USING "ContactToTag" AS survivor
    WHERE duplicate."contactId" = ${duplicateContactId}
      AND survivor."contactId" = ${survivorContactId}
      AND duplicate."tagId" = survivor."tagId"
  `)
  await tx.execute(
    sql`UPDATE "ContactToTag" SET "contactId" = ${survivorContactId} WHERE "contactId" = ${duplicateContactId}`,
  )
  await tx.execute(
    sql`UPDATE "ContactNote" SET "contactId" = ${survivorContactId} WHERE "contactId" = ${duplicateContactId}`,
  )
  await tx.execute(sql`
    DELETE FROM "ContactOnSequence" AS duplicate
    USING "ContactOnSequence" AS survivor
    WHERE duplicate."contactId" = ${duplicateContactId}
      AND survivor."contactId" = ${survivorContactId}
      AND duplicate."sequenceId" = survivor."sequenceId"
      AND duplicate."workspaceId" = survivor."workspaceId"
  `)
  await tx.execute(
    sql`UPDATE "ContactOnSequence" SET "contactId" = ${survivorContactId} WHERE "contactId" = ${duplicateContactId}`,
  )
  await tx.execute(
    sql`UPDATE "TaskTarget" SET "contactId" = ${survivorContactId} WHERE "contactId" = ${duplicateContactId}`,
  )
  await tx.execute(sql`
    DELETE FROM "ContactOnBroadcast" AS duplicate
    USING "ContactOnBroadcast" AS survivor
    WHERE duplicate."contactId" = ${duplicateContactId}
      AND survivor."contactId" = ${survivorContactId}
      AND duplicate."broadcastId" = survivor."broadcastId"
  `)
  await tx.execute(
    sql`UPDATE "ContactOnBroadcast" SET "contactId" = ${survivorContactId} WHERE "contactId" = ${duplicateContactId}`,
  )
}

const retargetConversationRows = async (
  tx: DatabaseClient,
  targetConversationId: string,
  duplicateConversationId: string,
) => {
  for (const table of CONVERSATION_TABLES) {
    await tx.execute(
      sql`UPDATE ${sql.identifier(table)} SET "conversationId" = ${targetConversationId} WHERE "conversationId" = ${duplicateConversationId}`,
    )
  }
}

const foldConversationActivity = async (
  tx: DatabaseClient,
  workspaceId: string,
  targetConversationId: string,
  duplicateConversationId: string,
) => {
  await tx.execute(sql`
    UPDATE "Conversation" AS survivor
    SET
      "lastActivityAt" = GREATEST(survivor."lastActivityAt", duplicate."lastActivityAt"),
      "inboxActivityAt" = GREATEST(survivor."inboxActivityAt", duplicate."inboxActivityAt"),
      "contactRepliedAt" = GREATEST(survivor."contactRepliedAt", duplicate."contactRepliedAt"),
      "adminRepliedAt" = GREATEST(survivor."adminRepliedAt", duplicate."adminRepliedAt"),
      "contactLastReadAt" = GREATEST(survivor."contactLastReadAt", duplicate."contactLastReadAt"),
      "agentLastReadAt" = GREATEST(survivor."agentLastReadAt", duplicate."agentLastReadAt"),
      "botEnabled" = survivor."botEnabled" AND duplicate."botEnabled",
      "assignedUserId" = COALESCE(survivor."assignedUserId", duplicate."assignedUserId"),
      "assignedInboxTeamId" = COALESCE(survivor."assignedInboxTeamId", duplicate."assignedInboxTeamId"),
      "handedOverAt" = COALESCE(survivor."handedOverAt", duplicate."handedOverAt"),
      "handoverCategory" = COALESCE(survivor."handoverCategory", duplicate."handoverCategory"),
      "additionalAttributes" = COALESCE(survivor."additionalAttributes", duplicate."additionalAttributes"),
      "updatedAt" = NOW()
    FROM "Conversation" AS duplicate
    WHERE survivor.id = ${targetConversationId}
      AND duplicate.id = ${duplicateConversationId}
      AND survivor."workspaceId" = ${workspaceId}
  `)
}

const foldAgentCursor = async (
  tx: DatabaseClient,
  targetConversationId: string,
  duplicateConversationId: string,
) => {
  const rows = await tx
    .select()
    .from(externalAgentConversationStateModel)
    .where(
      inArray(externalAgentConversationStateModel.conversationId, [
        targetConversationId,
        duplicateConversationId,
      ]),
    )
  const target = rows.find((row) => row.conversationId === targetConversationId)
  const duplicate = rows.find(
    (row) => row.conversationId === duplicateConversationId,
  )
  if (!duplicate) {
    return
  }
  if (!target) {
    await tx
      .update(externalAgentConversationStateModel)
      .set({ conversationId: targetConversationId })
      .where(
        eq(
          externalAgentConversationStateModel.conversationId,
          duplicateConversationId,
        ),
      )
    return
  }
  const duplicateCursor = duplicate.cursorAt?.getTime() ?? 0
  const targetCursor = target.cursorAt?.getTime() ?? 0
  if (duplicateCursor <= targetCursor) {
    return
  }
  await tx
    .update(externalAgentConversationStateModel)
    .set({
      cursorAt: duplicate.cursorAt,
      cursorMessageId: duplicate.cursorMessageId,
    })
    .where(
      eq(
        externalAgentConversationStateModel.conversationId,
        targetConversationId,
      ),
    )
}

const moveMessages = async (
  tx: DatabaseClient,
  workspaceId: string,
  targetConversationId: string,
  duplicateConversationId: string,
  survivorContactId: string,
  duplicateContactId: string,
) => {
  await tx
    .update(messageModel)
    .set({ conversationId: targetConversationId })
    .where(
      and(
        eq(messageModel.workspaceId, workspaceId),
        eq(messageModel.conversationId, duplicateConversationId),
      ),
    )
  await tx
    .update(messageModel)
    .set({ senderId: survivorContactId })
    .where(
      and(
        eq(messageModel.workspaceId, workspaceId),
        eq(messageModel.conversationId, targetConversationId),
        eq(messageModel.senderId, duplicateContactId),
      ),
    )
  await tx
    .update(attachmentModel)
    .set({ conversationId: targetConversationId })
    .where(
      and(
        eq(attachmentModel.workspaceId, workspaceId),
        eq(attachmentModel.conversationId, duplicateConversationId),
      ),
    )
}

const moveCustomFields = async (
  tx: DatabaseClient,
  survivorContactId: string,
  duplicateContactId: string,
) => {
  const survivorFields = await tx
    .select({ customFieldId: contactCustomFieldModel.customFieldId })
    .from(contactCustomFieldModel)
    .where(eq(contactCustomFieldModel.contactId, survivorContactId))
  const survivorFieldIds = survivorFields.map((field) => field.customFieldId)
  if (survivorFieldIds.length > 0) {
    await tx
      .delete(contactCustomFieldModel)
      .where(
        and(
          eq(contactCustomFieldModel.contactId, duplicateContactId),
          inArray(contactCustomFieldModel.customFieldId, survivorFieldIds),
        ),
      )
  }
  await tx
    .update(contactCustomFieldModel)
    .set({ contactId: survivorContactId })
    .where(eq(contactCustomFieldModel.contactId, duplicateContactId))
}

const moveExternalRows = async (
  tx: DatabaseClient,
  workspaceId: string,
  survivorContactId: string,
  duplicateContactId: string,
) => {
  const survivorIdentities = await tx
    .select({
      provider: externalCustomerIdentityModel.provider,
      externalCustomerId: externalCustomerIdentityModel.externalCustomerId,
    })
    .from(externalCustomerIdentityModel)
    .where(eq(externalCustomerIdentityModel.contactId, survivorContactId))
  for (const identity of survivorIdentities) {
    await tx
      .delete(externalCustomerIdentityModel)
      .where(
        and(
          eq(externalCustomerIdentityModel.contactId, duplicateContactId),
          eq(externalCustomerIdentityModel.provider, identity.provider),
          eq(
            externalCustomerIdentityModel.externalCustomerId,
            identity.externalCustomerId,
          ),
        ),
      )
  }
  await tx
    .update(externalCustomerIdentityModel)
    .set({ contactId: survivorContactId })
    .where(
      and(
        eq(externalCustomerIdentityModel.workspaceId, workspaceId),
        eq(externalCustomerIdentityModel.contactId, duplicateContactId),
      ),
    )

  const survivorOrders = await tx
    .select({
      provider: externalOrderModel.provider,
      externalOrderId: externalOrderModel.externalOrderId,
    })
    .from(externalOrderModel)
    .where(eq(externalOrderModel.contactId, survivorContactId))
  for (const order of survivorOrders) {
    await tx
      .delete(externalOrderModel)
      .where(
        and(
          eq(externalOrderModel.contactId, duplicateContactId),
          eq(externalOrderModel.provider, order.provider),
          eq(externalOrderModel.externalOrderId, order.externalOrderId),
        ),
      )
  }
  await tx
    .update(externalOrderModel)
    .set({ contactId: survivorContactId })
    .where(
      and(
        eq(externalOrderModel.workspaceId, workspaceId),
        eq(externalOrderModel.contactId, duplicateContactId),
      ),
    )
}

const fillEmptyProfile = async (
  tx: DatabaseClient,
  survivorContactId: string,
  duplicateContactId: string,
) => {
  await tx.execute(sql`
    UPDATE "Contact" AS survivor
    SET
      "firstName" = COALESCE(NULLIF(survivor."firstName", ''), duplicate."firstName"),
      "lastName" = COALESCE(NULLIF(survivor."lastName", ''), duplicate."lastName"),
      "email" = COALESCE(NULLIF(survivor."email", ''), duplicate."email"),
      "phoneNumber" = COALESCE(survivor."phoneNumber", duplicate."phoneNumber"),
      "blockedAt" = LEAST(survivor."blockedAt", duplicate."blockedAt"),
      "emailOptIn" = survivor."emailOptIn" AND duplicate."emailOptIn",
      "broadcastSubscribedAt" = CASE
        WHEN survivor."broadcastSubscribedAt" IS NULL
          OR duplicate."broadcastSubscribedAt" IS NULL THEN NULL
        ELSE survivor."broadcastSubscribedAt"
      END,
      "aiCallOptOutAt" = COALESCE(survivor."aiCallOptOutAt", duplicate."aiCallOptOutAt"),
      "aiCallOptOutSource" = CASE
        WHEN survivor."aiCallOptOutAt" IS NOT NULL THEN survivor."aiCallOptOutSource"
        ELSE duplicate."aiCallOptOutSource"
      END,
      "aiCallOptOutReason" = CASE
        WHEN survivor."aiCallOptOutAt" IS NOT NULL THEN survivor."aiCallOptOutReason"
        ELSE duplicate."aiCallOptOutReason"
      END,
      "updatedAt" = NOW()
    FROM "Contact" AS duplicate
    WHERE survivor.id = ${survivorContactId}
      AND duplicate.id = ${duplicateContactId}
  `)
}

/**
 * Moves one contact's channels and dialogs onto another, then deletes the
 * duplicate card. The older card is the one that stays; the caller picks it.
 * Messages move into the survivor's matching conversation so the inbox shows
 * one thread. The external-agent cursor moves forward to whichever dialog had
 * already seen the later client message, so those messages are not answered again.
 */
export const mergeContactInto = async (props: {
  workspaceId: string
  survivorContactId: string
  duplicateContactId: string
}): Promise<void> => {
  const { workspaceId, survivorContactId, duplicateContactId } = props
  if (survivorContactId === duplicateContactId) {
    return
  }

  const duplicateConversationIds: string[] = []
  const merged = await db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: contactModel.id })
      .from(contactModel)
      .where(
        and(
          eq(contactModel.workspaceId, workspaceId),
          inArray(contactModel.id, [survivorContactId, duplicateContactId]),
        ),
      )
      .orderBy(contactModel.id)
      .for("update")
    if (locked.length !== 2) {
      return false
    }

    await liftDecompressionLimit(tx)

    await tx
      .update(contactInboxModel)
      .set({
        contactId: survivorContactId,
        originalContactId: survivorContactId,
      })
      .where(eq(contactInboxModel.contactId, duplicateContactId))

    const conversations = await tx
      .select()
      .from(conversationModel)
      .where(
        and(
          eq(conversationModel.workspaceId, workspaceId),
          inArray(conversationModel.contactId, [
            survivorContactId,
            duplicateContactId,
          ]),
        ),
      )
    const survivorConversations = conversations.filter(
      (conversation) => conversation.contactId === survivorContactId,
    )
    const duplicateConversations = conversations.filter(
      (conversation) => conversation.contactId === duplicateContactId,
    )

    for (const duplicateConversation of duplicateConversations) {
      const target = survivorConversations.find(
        (conversation) =>
          (conversation.sourceId ?? null) ===
          (duplicateConversation.sourceId ?? null),
      )
      if (!target) {
        await tx
          .update(conversationModel)
          .set({ contactId: survivorContactId })
          .where(eq(conversationModel.id, duplicateConversation.id))
        survivorConversations.push({
          ...duplicateConversation,
          contactId: survivorContactId,
        })
        continue
      }

      await dedupeConversationParticipants(
        tx,
        target.id,
        duplicateConversation.id,
      )
      await moveMessages(
        tx,
        workspaceId,
        target.id,
        duplicateConversation.id,
        survivorContactId,
        duplicateContactId,
      )
      await retargetConversationRows(tx, target.id, duplicateConversation.id)
      await foldConversationActivity(
        tx,
        workspaceId,
        target.id,
        duplicateConversation.id,
      )
      await foldAgentCursor(tx, target.id, duplicateConversation.id)
      await tx
        .delete(conversationModel)
        .where(eq(conversationModel.id, duplicateConversation.id))
      duplicateConversationIds.push(duplicateConversation.id)
    }

    await moveCustomFields(tx, survivorContactId, duplicateContactId)
    await moveContactScopedRows(tx, survivorContactId, duplicateContactId)
    await moveExternalRows(
      tx,
      workspaceId,
      survivorContactId,
      duplicateContactId,
    )
    await fillEmptyProfile(tx, survivorContactId, duplicateContactId)
    return true
  })
  if (!merged) {
    return
  }

  await contactService.delete({
    workspaceId,
    ids: [duplicateContactId],
  })
  await invalidateCacheByTags([
    "contacts",
    `contacts:${workspaceId}`,
    `contacts:${survivorContactId}`,
    `contacts:${duplicateContactId}`,
    `contacts:${survivorContactId}:contact-inboxes`,
    `contacts:${duplicateContactId}:contact-inboxes`,
    "conversations",
    `conversations:${workspaceId}`,
    ...duplicateConversationIds.map((id) => `conversations:${id}`),
  ])
  logger.info(
    { workspaceId, survivorContactId, duplicateContactId },
    "Merged duplicate contact into the older card",
  )
}

/**
 * The contact a new channel dialog should join, or null when the phone and
 * email match nobody. Several cards that share the phone are folded into the
 * oldest one first.
 */
export const findContactForIdentity = async (props: {
  workspaceId: string
  phoneNumber?: string | null
  email?: string | null
}): Promise<string | null> => {
  const matches = await loadIdentityMatches(props)
  if (matches.length === 0) {
    return null
  }
  const survivor = pickSurvivor(matches)
  for (const match of matches) {
    if (match.id === survivor.id) {
      continue
    }
    await mergeContactInto({
      workspaceId: props.workspaceId,
      survivorContactId: survivor.id,
      duplicateContactId: match.id,
    })
  }
  const kept = await contactService.findById({
    workspaceId: props.workspaceId,
    id: survivor.id,
  })
  return kept ? survivor.id : null
}

/**
 * Folds other cards that share this contact's phone (or, when there is no
 * phone match, its email) into the oldest card. Returns the card that remains.
 */
export const unifySameClient = async (props: {
  workspaceId: string
  contactId: string
}): Promise<{ survivorContactId: string } | null> => {
  const contact = await contactService.findById({
    workspaceId: props.workspaceId,
    id: props.contactId,
  })
  if (!contact) {
    return null
  }
  const matches = await loadIdentityMatches({
    workspaceId: props.workspaceId,
    phoneNumber: contact.phoneNumber,
    email: contact.email,
  })
  const others = matches.filter((match) => match.id !== contact.id)
  if (others.length === 0) {
    return null
  }
  const survivor = pickSurvivor([
    {
      id: contact.id,
      createdAt: contact.createdAt,
      phoneNumber: contact.phoneNumber,
      email: contact.email,
    },
    ...others,
  ])
  for (const match of [contact, ...others]) {
    if (match.id === survivor.id) {
      continue
    }
    await mergeContactInto({
      workspaceId: props.workspaceId,
      survivorContactId: survivor.id,
      duplicateContactId: match.id,
    })
  }
  return { survivorContactId: survivor.id }
}
