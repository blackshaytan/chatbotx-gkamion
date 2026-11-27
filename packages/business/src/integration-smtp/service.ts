import type { DatabaseClient } from "@chatbotx.io/database/client"
import { and, db, eq, findOrFail } from "@chatbotx.io/database/client"
import { channelTypes } from "@chatbotx.io/database/partials"
import { inboxRepository } from "@chatbotx.io/database/repositories"
import { integrationSmtpModel } from "@chatbotx.io/database/schema"
import type {
  InboxModel,
  IntegrationSmtpModel,
} from "@chatbotx.io/database/types"
import { createId } from "@chatbotx.io/utils"
import { isSameJsonValue } from "../audit/diff"
import { BaseService } from "../base.service"
import {
  CONNECTION_STORE_BINDINGS,
  type ConnectionQuotaConsumption,
  upsertConnectionRow,
  withQuotaCompensation,
} from "../connection"
import { connectionStateService } from "../connection/state-service"
import { ChatbotXException } from "../errors"
import { inboxService } from "../inbox/service"
import { smtpOwnershipService } from "../inbox/smtp-ownership"
import type { SmtpEditableSettings } from "./schema"

/** An integration row plus the owner of its inbox (`Inbox.ownerUserId`). */
export type IntegrationSmtpWithOwner = IntegrationSmtpModel & {
  ownerUserId: string | null
}

/**
 * Mirrors `SmtpAuthValue` from `@chatbotx.io/integration-smtp` without
 * importing that package into business (it would pull `nodemailer` +
 * `next-intl` transitively into every business consumer, including the
 * worker). Host/port resolution against `smtpHostMap` stays in the builder
 * and is passed in already resolved.
 */
type SmtpAuthInput = {
  authType: "custom"
  provider: string
  host: string
  port: number
  username: string
  password: string
  fromAddress?: string
  receiveEnabled?: boolean
  imapHost?: string
  imapPort?: number
}

/**
 * Every field is optional: the builder's update form submits only what the
 * user touched, and each missing value falls back to the row's current auth.
 * `host`/`port` must already be resolved against `smtpHostMap` by the caller
 * (see the note above) — this service only fills them from the stored row.
 */
export type UpdateSmtpInput = Partial<{
  provider: string
  host: string
  port: number
  username: string
  password: string
  fromAddress: string
  receiveEnabled: boolean
  imapHost: string
  imapPort: number
  /** Personal owner, or null to make the mailbox shared. Omit to keep it. */
  ownerUserId: string | null
}>

const toEditableSettings = (
  row: IntegrationSmtpModel,
  ownerUserId: string | null,
): SmtpEditableSettings => {
  const auth = row.auth as Partial<SmtpAuthInput>
  return {
    id: row.id,
    name: row.name,
    fromAddress: row.fromAddress,
    provider: auth.provider || "other",
    host: auth.host || "",
    port: auth.port || 587,
    username: auth.username || row.name,
    receiveEnabled: auth.receiveEnabled ?? true,
    imapHost: auth.imapHost || "",
    imapPort: auth.imapPort ?? null,
    ownerUserId,
  }
}

class IntegrationSmtpService extends BaseService {
  find({
    where,
  }: {
    where: Partial<{ workspaceId: string; id: string }>
  }): Promise<IntegrationSmtpModel | undefined> {
    return db.query.integrationSmtpModel.findFirst({
      where,
    })
  }

  async findByIdForWorkspace(props: {
    id: string
    workspaceId: string
  }): Promise<IntegrationSmtpWithOwner> {
    const integration = await findOrFail({
      table: integrationSmtpModel,
      where: { id: props.id, workspaceId: props.workspaceId },
      message: "SMTP integration not found",
    })
    const inbox = await inboxRepository.findById({ id: integration.inboxId })

    return { ...integration, ownerUserId: inbox?.ownerUserId ?? null }
  }

  async listByWorkspace(workspaceId: string): Promise<SmtpEditableSettings[]> {
    const data = await db.query.integrationSmtpModel.findMany({
      where: { workspaceId },
      with: {
        inbox: { columns: { ownerUserId: true } },
      },
      orderBy: {
        createdAt: "desc",
      },
    })

    return data.map((row) => toEditableSettings(row, row.inbox.ownerUserId))
  }

  async connect(input: {
    workspaceId: string
    ownerId: string
    name: string
    fromAddress: string
    auth: SmtpAuthInput
    /** Personal owner, or null/omitted for a shared mailbox. */
    ownerUserId?: string | null
  }): Promise<{ inbox: InboxModel; wasCreated: boolean; smtpId: string }> {
    const { workspaceId, ownerId, name, fromAddress, auth, ownerUserId } = input

    const smtpId = createId()
    const quotaConsumption: ConnectionQuotaConsumption = {
      consumed: false,
      workspaceUsageIncremented: false,
    }

    const { inbox, wasCreated } = await withQuotaCompensation(
      {
        ownerId,
        quotaConsumption,
        context: { provider: "smtp" },
      },
      () =>
        db.transaction(async (tx) => {
          const { inbox, wasCreated } = await inboxService.create({
            tx,
            ownerId,
            data: {
              id: smtpId,
              workspaceId,
              channel: channelTypes.enum.smtp,
              name,
              sourceId: smtpId,
            },
            skipQuota: true,
          })

          // `id === inboxId === sourceId` — the smtp binding's
          // `identityColumn: "id"` (`store-bindings.ts`) sets `IntegrationSmtp
          // .id` to this same `smtpId` on insert, keeping one id for the
          // inbox, the integration row, and the connection's sourceId.
          await upsertConnectionRow({
            tx,
            workspaceId,
            provider: "smtp",
            kind: "channel",
            descriptor: { sourceId: smtpId, displayName: name },
            // `fromAddress` is also a column. The poller only sees `auth`,
            // so the address is copied there to skip the mailbox's own mail.
            auth: { ...auth, fromAddress },
            extraConfig: { fromAddress },
            existing: undefined,
            store: CONNECTION_STORE_BINDINGS.smtp as NonNullable<
              (typeof CONNECTION_STORE_BINDINGS)["smtp"]
            >,
            ownerId,
            quotaConsumption,
            inboxId: inbox.id,
          })

          if (ownerUserId !== undefined) {
            await smtpOwnershipService.setOwner({
              workspaceId,
              inboxId: inbox.id,
              ownerUserId,
              tx,
            })
          }

          return { inbox, wasCreated }
        }),
    )

    if (wasCreated) {
      await this.audit("connect", `connected a new SMTP channel (#${inbox.id})`)
    }

    return { inbox, wasCreated, smtpId }
  }

  /**
   * Merges `data` over the row's stored auth, writes it, and records an audit
   * entry only when the resulting payload actually differs. Both the merge and
   * the diff live here so any future caller (public API, worker) gets them for
   * free — see `.agents/rules/data-access.md` on public and private paths
   * sharing one service method.
   *
   * `data.ownerUserId` (when present) is written to the inbox in the same
   * transaction, so a rejected owner leaves the credentials untouched.
   */
  async update(input: {
    workspaceId: string
    id: string
    data: UpdateSmtpInput
    tx?: DatabaseClient
  }): Promise<IntegrationSmtpModel> {
    const { workspaceId, id, data, tx } = input

    const integration = await this.findByIdForWorkspace({ id, workspaceId })
    const currentAuth = integration.auth as SmtpAuthInput

    const name = data.username ?? integration.name
    const fromAddress = data.fromAddress ?? integration.fromAddress
    const receiveEnabled = data.receiveEnabled ?? currentAuth.receiveEnabled
    const imapHost = data.imapHost ?? currentAuth.imapHost
    const imapPort = data.imapPort ?? currentAuth.imapPort
    const auth: SmtpAuthInput = {
      authType: "custom",
      provider: data.provider ?? currentAuth.provider,
      host: data.host || currentAuth.host,
      port: data.port || currentAuth.port,
      username: data.username ?? currentAuth.username,
      password: data.password ?? currentAuth.password,
      fromAddress,
      ...(receiveEnabled === undefined ? {} : { receiveEnabled }),
      ...(imapHost ? { imapHost } : {}),
      ...(imapPort ? { imapPort } : {}),
    }

    const run = async (client: DatabaseClient) => {
      if (data.ownerUserId !== undefined) {
        await smtpOwnershipService.setOwner({
          workspaceId,
          inboxId: integration.inboxId,
          ownerUserId: data.ownerUserId,
          tx: client,
        })
      }

      // Scoped by workspace as well as id: `findByIdForWorkspace` above already
      // proves ownership, but this method accepts a `workspaceId` and must
      // honour it rather than trusting every future caller to guard first.
      const [updated] = await client
        .update(integrationSmtpModel)
        .set({ auth, name, fromAddress })
        .where(
          and(
            eq(integrationSmtpModel.id, id),
            eq(integrationSmtpModel.workspaceId, workspaceId),
          ),
        )
        .returning()

      if (!updated) {
        throw new ChatbotXException("SMTP integration not found")
      }
      return updated
    }

    const updated = tx ? await run(tx) : await db.transaction(run)

    const hasChanged = !isSameJsonValue(
      { auth, name, fromAddress },
      {
        auth: currentAuth,
        name: integration.name,
        fromAddress: integration.fromAddress,
      },
    )
    const ownerChanged =
      data.ownerUserId !== undefined &&
      data.ownerUserId !== integration.ownerUserId

    if (hasChanged || ownerChanged) {
      await this.audit("update", "updated the SMTP channel configuration")
    }

    return updated
  }

  async disconnect(input: {
    workspaceId: string
    id: string
    inboxId: string
    ownerId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, id, inboxId, ownerId, tx } = input

    const run = async (client: DatabaseClient) => {
      await client
        .delete(integrationSmtpModel)
        .where(
          and(
            eq(integrationSmtpModel.id, id),
            eq(integrationSmtpModel.workspaceId, workspaceId),
          ),
        )

      await connectionStateService.disconnectInbox({
        inboxId,
        ownerId,
        workspaceId,
        tx: client,
      })
    }

    if (tx) {
      await run(tx)
    } else {
      await db.transaction(run)
    }

    await this.audit("disconnect", `disconnected the SMTP channel (#${id})`)
  }
}
export const integrationSmtpService = new IntegrationSmtpService()
