import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { realDatabaseUrl } from "./database-url"

const databaseUrl = realDatabaseUrl()

describe.skipIf(!databaseUrl)("staff chat schema", () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl as string })
    await client.connect()
  })

  afterAll(async () => {
    await client?.end()
  })

  test("creates the thread fields and indexes", async () => {
    const { rows: columns } = await client.query<{
      column_name: string
      is_nullable: string
      column_default: string | null
    }>(
      `select column_name, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'InternalThread'
          and column_name = any($1)`,
      [["title", "directKey", "lastMessageAt"]],
    )
    expect(columns).toEqual(
      expect.arrayContaining([
        { column_name: "title", is_nullable: "YES", column_default: null },
        {
          column_name: "directKey",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "lastMessageAt",
          is_nullable: "YES",
          column_default: null,
        },
      ]),
    )

    const { rows: indexes } = await client.query<{
      indexname: string
      indexdef: string
    }>(
      `select indexname, indexdef
         from pg_indexes
        where schemaname = 'public'
          and ((tablename = 'InternalThread' and indexname = any($1))
            or (tablename = 'Notification' and indexname = 'Notification_chat_unread_key'))`,
      [
        [
          "InternalThread_workspaceId_directKey_key",
          "InternalThread_workspaceId_type_lastMessageAt_idx",
        ],
      ],
    )
    expect(indexes.map((index) => index.indexname)).toEqual(
      expect.arrayContaining([
        "InternalThread_workspaceId_directKey_key",
        "InternalThread_workspaceId_type_lastMessageAt_idx",
        "Notification_chat_unread_key",
      ]),
    )
    const chatUnreadDefinition = indexes.find(
      (index) => index.indexname === "Notification_chat_unread_key",
    )?.indexdef
    expect(chatUnreadDefinition).toContain("\"entityType\" = 'chat'")
    expect(chatUnreadDefinition).toContain('"readAt" IS NULL')
  })

  test("adds direct and agent enum values", async () => {
    const { rows } = await client.query<{ enumlabel: string }>(
      `select enumlabel
         from pg_enum
         join pg_type on pg_type.oid = pg_enum.enumtypid
        where pg_type.typname = 'internalThreadType'
        order by enumsortorder`,
    )

    expect(rows.map((row) => row.enumlabel)).toEqual(
      expect.arrayContaining(["direct", "agent"]),
    )
  })
})
