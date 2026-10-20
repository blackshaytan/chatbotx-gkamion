import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const GEKA_CHANNELS = ["max", "zzap", "drom"] as const
export type GekaChannel = (typeof GEKA_CHANNELS)[number]

export const DEFAULT_GEKA_DIR = fileURLToPath(
  new URL("../../../.secrets/geka", import.meta.url),
)

export type GekaImportOptions = {
  workspaceId: string
  apply: boolean
  only: GekaChannel[]
  from: string
}

export class GekaImportError extends Error {}

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/
const QUOTED = /^(["'])(.*)\1$/
const LINE_BREAK = /\r?\n/
const TRUE_VALUES = new Set(["1", "true", "yes", "on"])

export const parseArgs = (
  argv: string[],
  cwd: string = process.cwd(),
): GekaImportOptions => {
  const options: GekaImportOptions = {
    workspaceId: "",
    apply: false,
    only: [...GEKA_CHANNELS],
    from: DEFAULT_GEKA_DIR,
  }
  const queue = [...argv]
  while (queue.length > 0) {
    const arg = queue.shift()
    const next = () => {
      const value = queue.shift()
      if (!value || value.startsWith("--")) {
        throw new GekaImportError(`${arg} needs a value`)
      }
      return value
    }
    if (arg === "--workspace") {
      options.workspaceId = next()
    } else if (arg === "--apply") {
      options.apply = true
    } else if (arg === "--from") {
      const from = next()
      options.from = isAbsolute(from) ? from : resolve(cwd, from)
    } else if (arg === "--only") {
      const only = next()
        .split(",")
        .map((name) => name.trim())
      const unknown = only.filter(
        (name) => !(GEKA_CHANNELS as readonly string[]).includes(name),
      )
      if (unknown.length > 0) {
        throw new GekaImportError(`Unknown channel(s): ${unknown.join(", ")}`)
      }
      options.only = only as GekaChannel[]
    } else if (arg !== "--") {
      throw new GekaImportError(`Unknown argument: ${arg}`)
    }
  }
  if (!options.workspaceId) {
    throw new GekaImportError("--workspace <id> is required")
  }
  return options
}

export const parseEnvFile = (text: string): Record<string, string> => {
  const values: Record<string, string> = {}
  for (const line of text.split(LINE_BREAK)) {
    const match = ENV_LINE.exec(line)
    if (match?.[1]) {
      const raw = (match[2] ?? "").trim()
      values[match[1]] = QUOTED.exec(raw)?.[2] ?? raw
    }
  }
  return values
}

export const mask = (value: string | undefined): string => {
  if (!value) {
    return "(empty)"
  }
  return value.length >= 20
    ? `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`
    : `•••• (${value.length} chars)`
}

const readText = (dir: string, name: string): string => {
  const path = join(dir, name)
  if (!existsSync(path)) {
    throw new GekaImportError(`${name} not found in ${dir}`)
  }
  return readFileSync(path, "utf8")
}

const readJson = (dir: string, name: string): unknown => {
  try {
    return JSON.parse(readText(dir, name))
  } catch (err) {
    if (err instanceof GekaImportError) {
      throw err
    }
    throw new GekaImportError(`${name} is not valid JSON`)
  }
}

const optionalNumber = (
  env: Record<string, string>,
  key: string,
): number | undefined => {
  const raw = env[key]?.trim()
  if (!raw) {
    return
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new GekaImportError(`${key} is not a number`)
  }
  return value
}

const required = (env: Record<string, string>, key: string, file: string) => {
  const value = env[key]?.trim()
  if (!value) {
    throw new GekaImportError(`${key} is empty in ${file}`)
  }
  return value
}

export type MaxSource = { secretText: string; webhookSecret?: string }

export type ZzapSource = {
  secretText: string
  codeObject: string
  typeObject: string
  testMode: boolean
  pollIntervalSeconds?: number
  maxThreadsPerPoll?: number
  requestMinIntervalSeconds?: number
}

export type DromDialogCursor = {
  lastInboundId: string
  lastMessageDate: number
  seenDealIds: string[]
  fetchedDealUrls: string[]
  updatedAt: number
}

export type DromSource = {
  secretText: string
  sellerLogin: string
  pollIntervalSeconds?: number
  cursor: { dialogs: Record<string, DromDialogCursor> } | null
}

export const readMaxSource = (dir: string): MaxSource => {
  const env = parseEnvFile(readText(dir, "max.env"))
  return {
    secretText: required(env, "MAX_BOT_TOKEN", "max.env"),
    webhookSecret: env.MAX_WEBHOOK_SECRET?.trim() || undefined,
  }
}

export const readZzapSource = (dir: string): ZzapSource => {
  const env = parseEnvFile(readText(dir, "zzap.env"))
  return {
    secretText: required(env, "ZZAP_API_KEY", "zzap.env"),
    codeObject: env.CODE_OBJECT?.trim() || "-1",
    typeObject: env.TYPE_OBJECT?.trim() || "0",
    testMode: TRUE_VALUES.has((env.TEST_MODE ?? "").trim().toLowerCase()),
    pollIntervalSeconds: optionalNumber(env, "POLL_INTERVAL_SECONDS"),
    maxThreadsPerPoll: optionalNumber(env, "MAX_THREADS_PER_POLL"),
    requestMinIntervalSeconds: optionalNumber(
      env,
      "REQUEST_MIN_INTERVAL_SECONDS",
    ),
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asNumber = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/** Geka's `poll-state.json` (snake_case, unix seconds) as the DROM cursor. */
export const toDromCursor = (
  state: unknown,
): { dialogs: Record<string, DromDialogCursor> } => {
  const dialogs: Record<string, DromDialogCursor> = {}
  for (const [dialogId, raw] of Object.entries(
    asRecord(asRecord(state).dialogs),
  )) {
    const entry = asRecord(raw)
    const seen = Array.isArray(entry.seen_deal_ids) ? entry.seen_deal_ids : []
    const orderUrl =
      typeof entry.order_url === "string" ? entry.order_url.trim() : ""
    dialogs[dialogId] = {
      lastInboundId:
        typeof entry.last_inbound_id === "string" ? entry.last_inbound_id : "",
      lastMessageDate: asNumber(entry.last_message_date),
      seenDealIds: seen.map(String),
      fetchedDealUrls: orderUrl ? [orderUrl] : [],
      updatedAt: asNumber(entry.updated_at) * 1000,
    }
  }
  return { dialogs }
}

export const readDromSource = (dir: string): DromSource => {
  const env = parseEnvFile(readText(dir, "drom.env"))
  const cookies = readText(dir, "drom-cookies.json")
  const statePath = join(dir, "drom-state.json")
  return {
    secretText: cookies,
    sellerLogin: required(env, "DROM_SELLER_LOGIN", "drom.env"),
    pollIntervalSeconds: optionalNumber(env, "DROM_POLL_INTERVAL"),
    cursor: existsSync(statePath)
      ? toDromCursor(readJson(dir, "drom-state.json"))
      : null,
  }
}

export type ImportOutcome = "created" | "revived" | "updatedAuth"

export type GekaImportDeps = {
  resolveMaxAuth: (input: MaxSource) => Promise<unknown>
  toZzapAuth: (input: ZzapSource) => unknown
  toDromAuth: (input: Omit<DromSource, "cursor">) => unknown
  importFromAuth: (input: {
    workspaceId: string
    provider: GekaChannel
    auth: unknown
    pollCursor?: Record<string, unknown> | null
  }) => Promise<{ connection: { id: string }; outcome: ImportOutcome }>
}

export type GekaImportReport = { lines: string[]; failed: number }

const OUTCOME_TEXT: Record<ImportOutcome, string> = {
  created: "created, paused",
  revived: "re-imported, paused, cursor replaced",
  updatedAuth: "channel is on: secrets replaced, status and cursor kept",
}

const describeSource = (channel: GekaChannel, dir: string): string => {
  if (channel === "max") {
    const source = readMaxSource(dir)
    return `token ${mask(source.secretText)}, webhook secret ${mask(source.webhookSecret)}; bot id/name via one GET /me on --apply`
  }
  if (channel === "zzap") {
    const source = readZzapSource(dir)
    return `key ${mask(source.secretText)}, codeObject ${source.codeObject}, typeObject ${source.typeObject}, testMode ${source.testMode}, poll ${source.pollIntervalSeconds ?? "default"}s, threads ${source.maxThreadsPerPoll ?? "default"}, spacing ${source.requestMinIntervalSeconds ?? "default"}s; cursor reset (first poll starts when turned on)`
  }
  const source = readDromSource(dir)
  const dialogs = source.cursor ? Object.keys(source.cursor.dialogs).length : 0
  return `seller ${source.sellerLogin}, cookies ${mask(source.secretText)}, poll ${source.pollIntervalSeconds ?? "default"}s; cursor ${source.cursor ? `${dialogs} dialogs from Geka` : "none"}`
}

const importChannel = async (
  channel: GekaChannel,
  options: GekaImportOptions,
  deps: GekaImportDeps,
) => {
  const base = { workspaceId: options.workspaceId, provider: channel }
  if (channel === "max") {
    const auth = await deps.resolveMaxAuth(readMaxSource(options.from))
    return await deps.importFromAuth({ ...base, auth })
  }
  if (channel === "zzap") {
    const auth = deps.toZzapAuth(readZzapSource(options.from))
    return await deps.importFromAuth({ ...base, auth, pollCursor: null })
  }
  const { cursor, ...source } = readDromSource(options.from)
  return await deps.importFromAuth({
    ...base,
    auth: deps.toDromAuth(source),
    pollCursor: cursor,
  })
}

/**
 * Reads only `options.from`. A dry run validates and prints the masked plan;
 * `--apply` persists each channel through `deps.importFromAuth`, which never
 * activates a channel. One channel failing does not stop the others.
 */
export const runGekaImport = async (
  options: GekaImportOptions,
  deps: GekaImportDeps,
  onError: (err: unknown, channel: GekaChannel) => void = () => undefined,
): Promise<GekaImportReport> => {
  const lines = [
    `Geka import → workspace ${options.workspaceId} (${options.apply ? "apply" : "dry run, nothing is written"}), from ${options.from}`,
  ]
  let failed = 0
  for (const channel of options.only) {
    try {
      lines.push(`  ${channel}: ${describeSource(channel, options.from)}`)
      if (options.apply) {
        const result = await importChannel(channel, options, deps)
        lines.push(
          `    → ${OUTCOME_TEXT[result.outcome]} (connection ${result.connection.id})`,
        )
      }
    } catch (err) {
      failed++
      onError(err, channel)
      const message = err instanceof Error ? err.message : String(err)
      lines.push(`  ${channel}: FAILED — ${message}`)
    }
  }
  return { lines, failed }
}
