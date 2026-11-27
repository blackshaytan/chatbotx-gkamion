import { describe, expect, it, vi } from "vitest"
import {
  parseArgs,
  runTransfer,
  type TransferDeps,
} from "../scripts/workspace-owner-transfer"

const WORKSPACE_ID = "ws-1"
const CURRENT_OWNER_ID = "user-old"
const NEW_OWNER_ID = "user-new"

const USERS: Record<string, { name: string; email: string }> = {
  [CURRENT_OWNER_ID]: { name: "Old Owner", email: "old@example.com" },
  [NEW_OWNER_ID]: { name: "New Owner", email: "new@example.com" },
}

const buildDeps = (order: string[] = []) => {
  const deps: TransferDeps = {
    findWorkspace: vi.fn((id: string) =>
      Promise.resolve(
        id === WORKSPACE_ID
          ? { id: WORKSPACE_ID, name: "Old Name", ownerId: CURRENT_OWNER_ID }
          : undefined,
      ),
    ),
    findUser: vi.fn((id: string) => Promise.resolve(USERS[id])),
    transfer: vi.fn(() => {
      order.push("transfer")
      return Promise.resolve()
    }),
    rename: vi.fn(() => {
      order.push("rename")
      return Promise.resolve()
    }),
  }
  return deps
}

const baseOptions = {
  workspaceId: WORKSPACE_ID,
  newOwnerId: NEW_OWNER_ID,
  apply: false,
}

describe("parseArgs", () => {
  it("reads all four flags", () => {
    expect(
      parseArgs([
        "--workspace",
        WORKSPACE_ID,
        "--owner",
        NEW_OWNER_ID,
        "--name",
        "Brand New",
        "--apply",
      ]),
    ).toEqual({
      workspaceId: WORKSPACE_ID,
      newOwnerId: NEW_OWNER_ID,
      name: "Brand New",
      apply: true,
    })
  })

  it("throws when --workspace is missing", () => {
    expect(() => parseArgs(["--owner", NEW_OWNER_ID])).toThrow("--workspace")
  })

  it("throws when --owner is missing", () => {
    expect(() => parseArgs(["--workspace", WORKSPACE_ID])).toThrow("--owner")
  })

  it("throws naming the flag when its value is missing", () => {
    expect(() => parseArgs(["--workspace", WORKSPACE_ID, "--owner"])).toThrow(
      "--owner",
    )
  })

  it("throws on an unknown flag", () => {
    expect(() =>
      parseArgs([
        "--workspace",
        WORKSPACE_ID,
        "--owner",
        NEW_OWNER_ID,
        "--force",
      ]),
    ).toThrow("--force")
  })
})

describe("runTransfer", () => {
  it("dry run loads both sides and writes nothing", async () => {
    const deps = buildDeps()

    const report = await runTransfer({ ...baseOptions, name: "Renamed" }, deps)

    expect(deps.findWorkspace).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(deps.findUser).toHaveBeenCalledWith(CURRENT_OWNER_ID)
    expect(deps.findUser).toHaveBeenCalledWith(NEW_OWNER_ID)
    expect(deps.transfer).not.toHaveBeenCalled()
    expect(deps.rename).not.toHaveBeenCalled()
    expect(report.applied).toBe(false)
  })

  it("dry run lines contain both emails and both names", async () => {
    const report = await runTransfer(
      { ...baseOptions, name: "Renamed" },
      buildDeps(),
    )
    const text = report.lines.join("\n")

    expect(text).toContain("old@example.com")
    expect(text).toContain("new@example.com")
    expect(text).toContain("Old Name")
    expect(text).toContain("Renamed")
    expect(text).toContain("Old Owner")
    expect(text).toContain("New Owner")
  })

  it("apply transfers first and then renames", async () => {
    const order: string[] = []
    const deps = buildDeps(order)

    const report = await runTransfer(
      { ...baseOptions, name: "Renamed", apply: true },
      deps,
    )

    expect(order).toEqual(["transfer", "rename"])
    expect(deps.transfer).toHaveBeenCalledWith(WORKSPACE_ID, NEW_OWNER_ID)
    expect(deps.rename).toHaveBeenCalledWith(WORKSPACE_ID, "Renamed")
    expect(report.applied).toBe(true)
  })

  it("apply without a name transfers and does not rename", async () => {
    const deps = buildDeps()

    const report = await runTransfer({ ...baseOptions, apply: true }, deps)

    expect(deps.transfer).toHaveBeenCalledWith(WORKSPACE_ID, NEW_OWNER_ID)
    expect(deps.rename).not.toHaveBeenCalled()
    expect(report.applied).toBe(true)
  })

  it("throws when the workspace is missing", async () => {
    await expect(
      runTransfer({ ...baseOptions, workspaceId: "missing" }, buildDeps()),
    ).rejects.toThrow("Workspace not found: missing")
  })

  it("throws when the new owner is missing and writes nothing", async () => {
    const deps = buildDeps()

    await expect(
      runTransfer({ ...baseOptions, newOwnerId: "ghost", apply: true }, deps),
    ).rejects.toThrow("User not found: ghost")
    expect(deps.transfer).not.toHaveBeenCalled()
    expect(deps.rename).not.toHaveBeenCalled()
  })
})
