/**
 * Hands a workspace to another user. Pure parse/run logic: the entry point
 * (`transfer-workspace-owner.ts`) wires the real services into `TransferDeps`.
 *
 * Usage (from the repo root):
 *   pnpm --filter worker workspace:transfer-owner -- --workspace <id> --owner <userId> [--name "<name>"] [--apply]
 *
 * Without `--apply` it is a dry run: the plan is printed and nothing is written.
 * With `--apply` the owner moves first, then the workspace is renamed when
 * `--name` is given. The previous owner is kept as an agent.
 */

export type WorkspaceOwnerTransferOptions = {
  workspaceId: string
  newOwnerId: string
  name?: string
  apply: boolean
}

export type WorkspaceOwnerTransferReport = {
  lines: string[]
  applied: boolean
}

export type TransferDeps = {
  findWorkspace: (
    id: string,
  ) => Promise<{ id: string; name: string; ownerId: string } | undefined>
  findUser: (
    id: string,
  ) => Promise<{ name: string | null; email: string | null } | undefined>
  transfer: (workspaceId: string, newOwnerId: string) => Promise<unknown>
  rename: (workspaceId: string, name: string) => Promise<unknown>
}

const VALUE_FLAGS = ["--workspace", "--owner", "--name"] as const
type ValueFlag = (typeof VALUE_FLAGS)[number]

const isValueFlag = (arg: string): arg is ValueFlag =>
  (VALUE_FLAGS as readonly string[]).includes(arg)

export const parseArgs = (argv: string[]): WorkspaceOwnerTransferOptions => {
  const values: Partial<Record<ValueFlag, string>> = {}
  let apply = false
  const queue = [...argv]

  while (queue.length > 0) {
    const arg = queue.shift()
    if (arg === undefined || arg === "--") {
      continue
    }
    if (arg === "--apply") {
      apply = true
      continue
    }
    if (!isValueFlag(arg)) {
      throw new Error(`Unknown argument: ${arg}`)
    }
    const value = queue.shift()
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} needs a value`)
    }
    values[arg] = value
  }

  if (!values["--workspace"]) {
    throw new Error("--workspace <id> is required")
  }
  if (!values["--owner"]) {
    throw new Error("--owner <userId> is required")
  }

  return {
    workspaceId: values["--workspace"],
    newOwnerId: values["--owner"],
    name: values["--name"],
    apply,
  }
}

const describeUser = (
  id: string,
  user: { name: string | null; email: string | null } | undefined,
): string => {
  const label = user?.email ?? id
  return user?.name ? `${label} (${user.name})` : label
}

export const runTransfer = async (
  options: WorkspaceOwnerTransferOptions,
  deps: TransferDeps,
): Promise<WorkspaceOwnerTransferReport> => {
  const workspace = await deps.findWorkspace(options.workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${options.workspaceId}`)
  }

  const currentOwner = await deps.findUser(workspace.ownerId)
  const newOwner = await deps.findUser(options.newOwnerId)
  if (!newOwner) {
    throw new Error(`User not found: ${options.newOwnerId}`)
  }

  const requestedName =
    options.name && options.name.length > 0 ? options.name : undefined
  const nextName = requestedName ?? workspace.name

  const lines = [
    `Workspace: ${workspace.id}`,
    `Current name: ${workspace.name}`,
    `New name: ${nextName}`,
    `Current owner: ${describeUser(workspace.ownerId, currentOwner)}`,
    `New owner: ${describeUser(options.newOwnerId, newOwner)}`,
  ]

  if (!options.apply) {
    return {
      lines: [...lines, "Dry run: nothing written. Add --apply to transfer."],
      applied: false,
    }
  }

  await deps.transfer(options.workspaceId, options.newOwnerId)
  if (requestedName !== undefined) {
    await deps.rename(options.workspaceId, requestedName)
  }

  return {
    lines: [...lines, "Applied: ownership transferred."],
    applied: true,
  }
}
