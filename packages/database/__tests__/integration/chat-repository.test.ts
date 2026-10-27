import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { relations } from "../../src/relations"
import { chatRepository } from "../../src/repositories/chat/repository"
// biome-ignore lint/performance/noNamespaceImport: mirrors how src/client.ts builds the db
import * as schema from "../../src/schema"
import { realDatabaseUrl } from "./database-url"

const databaseUrl = realDatabaseUrl()

const createDatabase = (client: Client) =>
  drizzle({ client, schema, relations })

describe.skipIf(!databaseUrl)("chatRepository against Postgres", () => {
  const clients: Client[] = []
  let workspaceId: string
  let userIds: string[]

  beforeAll(async () => {
    const primary = new Client({ connectionString: databaseUrl as string })
    clients.push(primary)
    await primary.connect()
    const db = createDatabase(primary)
    const [owner, peer] = await db
      .insert(schema.userModel)
      .values([
        { email: `chat-owner-${Date.now()}@example.test` },
        { email: `chat-peer-${Date.now()}@example.test` },
      ])
      .returning({ id: schema.userModel.id })
    userIds = [owner.id, peer.id]
    const [workspace] = await db
      .insert(schema.workspaceModel)
      .values({ name: "chat repository test", ownerId: owner.id })
      .returning({ id: schema.workspaceModel.id })
    workspaceId = workspace.id
    await db.insert(schema.workspaceMemberModel).values(
      userIds.map((userId, index) => ({
        workspaceId,
        userId,
        role: index === 0 ? "owner" : "agent",
      })),
    )
    for (let index = 0; index < 7; index += 1) {
      const client = new Client({ connectionString: databaseUrl as string })
      clients.push(client)
      await client.connect()
    }
  })

  afterAll(async () => {
    const primary = clients[0]
    if (primary && workspaceId) {
      const db = createDatabase(primary)
      await db
        .delete(schema.workspaceModel)
        .where(eq(schema.workspaceModel.id, workspaceId))
      await db
        .delete(schema.userModel)
        .where(eq(schema.userModel.id, userIds[0]))
      await db
        .delete(schema.userModel)
        .where(eq(schema.userModel.id, userIds[1]))
    }
    await Promise.all(clients.map((client) => client.end()))
  })

  test("concurrent getOrCreate calls leave one direct chat and two members", async () => {
    const results = await Promise.all(
      clients.map((client) =>
        chatRepository.getOrCreate({
          workspaceId,
          type: "direct",
          directKey: `${userIds[0]}:${userIds[1]}`,
          title: null,
          memberUserIds: userIds,
          tx: createDatabase(client),
        }),
      ),
    )

    expect(new Set(results.map((result) => result.thread.id)).size).toBe(1)
    expect(results.filter((result) => result.created)).toHaveLength(1)

    const db = createDatabase(clients[0])
    const threads = await db.query.internalThreadModel.findMany({
      where: { workspaceId, directKey: `${userIds[0]}:${userIds[1]}` },
    })
    const members = await db.query.internalThreadMemberModel.findMany({
      where: { threadId: threads[0]?.id },
    })
    expect(threads).toHaveLength(1)
    expect(members.map((member) => member.userId).sort()).toEqual(
      [...userIds].sort(),
    )
  })
})
