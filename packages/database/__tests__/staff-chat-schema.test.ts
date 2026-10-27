import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, test } from "vitest"
import { internalThreadModel, notificationModel } from "../src/schema"

const drizzleDirectory = join(import.meta.dirname, "../drizzle")
const migrationDirectory = readdirSync(drizzleDirectory).find((entry) =>
  entry.endsWith("_staff_chat"),
)

if (migrationDirectory === undefined) {
  throw new Error("staff_chat migration is missing")
}

const migrationSql = readFileSync(
  join(drizzleDirectory, migrationDirectory, "migration.sql"),
  "utf8",
)
const NEW_ENUM_VALUES = /'direct'|'agent'/
const MUTATING_SQL = /\b(?:UPDATE|INSERT|DROP)\b/

const columnNames = (index: { config: { columns: unknown[] } }) =>
  index.config.columns.map((column) =>
    typeof column === "object" && column !== null && "name" in column
      ? String(column.name)
      : String(column),
  )

describe("staff chat schema", () => {
  test("keeps chat fields nullable without defaults", () => {
    const columns = getTableConfig(internalThreadModel).columns

    for (const name of ["title", "directKey", "lastMessageAt"] as const) {
      const column = columns.find((candidate) => candidate.name === name)
      expect(column?.notNull).toBe(false)
      expect(column?.default).toBeUndefined()
    }
  })

  test("declares the direct key and recency indexes", () => {
    const indexes = getTableConfig(internalThreadModel).indexes
    const directKey = indexes.find(
      (index) =>
        index.config.name === "InternalThread_workspaceId_directKey_key",
    )
    const recency = indexes.find(
      (index) =>
        index.config.name ===
        "InternalThread_workspaceId_type_lastMessageAt_idx",
    )

    expect(directKey?.config.unique).toBe(true)
    expect(columnNames(directKey as NonNullable<typeof directKey>)).toEqual([
      "workspaceId",
      "directKey",
    ])
    expect(columnNames(recency as NonNullable<typeof recency>)).toEqual([
      "workspaceId",
      "type",
      "lastMessageAt",
    ])
  })

  test("declares the unread chat notification uniqueness constraint", () => {
    const chatUnread = getTableConfig(notificationModel).indexes.find(
      (index) => index.config.name === "Notification_chat_unread_key",
    )

    expect(chatUnread?.config.unique).toBe(true)
    expect(chatUnread?.config.where).toBeDefined()
  })

  test("adds new enum values separately from their use", () => {
    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean)
    const enumStatements = statements.filter((statement) =>
      statement.startsWith('ALTER TYPE "internalThreadType" ADD VALUE'),
    )

    expect(enumStatements).toEqual([
      "ALTER TYPE \"internalThreadType\" ADD VALUE 'direct';",
      "ALTER TYPE \"internalThreadType\" ADD VALUE 'agent';",
    ])
    expect(
      statements
        .filter(
          (statement) =>
            !statement.startsWith('ALTER TYPE "internalThreadType" ADD VALUE'),
        )
        .join("\n"),
    ).not.toMatch(NEW_ENUM_VALUES)
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "Notification_chat_unread_key" ON "Notification" ("workspaceId","userId","entityId") WHERE "entityType" = \'chat\' AND "readAt" IS NULL;',
    )
    expect(migrationSql).not.toMatch(MUTATING_SQL)
  })
})
