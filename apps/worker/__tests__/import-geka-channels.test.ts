import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_GEKA_DIR,
  type GekaImportDeps,
  type GekaImportOptions,
  parseArgs,
  parseEnvFile,
  runGekaImport,
  toDromCursor,
} from "../scripts/geka-import"

const MAX_TOKEN = "max-token-0123456789abcdef-SECRET"
const ZZAP_KEY = "zzap-key-0123456789abcdef-SECRET"
const COOKIE_VALUE = "ring-cookie-SECRET"

let dir: string

const writeSnapshot = () => {
  writeFileSync(
    join(dir, "max.env"),
    `# comment\nMAX_BOT_TOKEN=${MAX_TOKEN}\nMAX_WEBHOOK_SECRET="hook-secret"\n`,
  )
  writeFileSync(
    join(dir, "zzap.env"),
    [
      `ZZAP_API_KEY=${ZZAP_KEY}`,
      "CODE_OBJECT=-1",
      "TYPE_OBJECT=0",
      "TEST_MODE=false",
      "POLL_INTERVAL_SECONDS=180",
      "MAX_THREADS_PER_POLL=5",
      "REQUEST_MIN_INTERVAL_SECONDS=3.5",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, "drom.env"),
    "DROM_SELLER_LOGIN=12345678\nDROM_POLL_INTERVAL=\n",
  )
  writeFileSync(
    join(dir, "drom-cookies.json"),
    JSON.stringify([
      { name: "ring", value: COOKIE_VALUE },
      { name: "login", value: "12345678" },
    ]),
  )
  writeFileSync(
    join(dir, "drom-state.json"),
    JSON.stringify({
      last_poll_at: 1_792_486_741,
      dialogs: {
        "101": {
          last_inbound_id: "555",
          last_message_date: 1_792_000_000,
          seen_deal_ids: ["d1", 7],
          order_url: "https://baza.drom.ru/personal/deal/1",
          updated_at: 1_792_400_000,
        },
        "102": { last_inbound_id: "", updated_at: 1_792_400_001 },
      },
    }),
  )
}

const makeDeps = () => {
  const importFromAuth = vi.fn<GekaImportDeps["importFromAuth"]>(
    async (input) => ({
      connection: { id: `conn-${input.provider}` },
      outcome: "created",
    }),
  )
  const deps: GekaImportDeps = {
    resolveMaxAuth: vi.fn(async (input) => ({ ...input, botId: "1" })),
    toZzapAuth: vi.fn((input) => ({ ...input, kind: "zzap" })),
    toDromAuth: vi.fn((input) => ({ ...input, kind: "drom" })),
    importFromAuth,
  }
  return { deps, importFromAuth }
}

const options = (overrides: Partial<GekaImportOptions> = {}) => ({
  workspaceId: "ws-1",
  apply: false,
  only: ["max", "zzap", "drom"] as GekaImportOptions["only"],
  from: dir,
  ...overrides,
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "geka-import-"))
  writeSnapshot()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("parseArgs", () => {
  it("requires a workspace and defaults to a dry run of every channel", () => {
    expect(() => parseArgs([])).toThrow("--workspace <id> is required")
    expect(parseArgs(["--workspace", "ws-1"])).toEqual({
      workspaceId: "ws-1",
      apply: false,
      only: ["max", "zzap", "drom"],
      from: DEFAULT_GEKA_DIR,
    })
  })

  it("parses --apply, --only and a relative --from against the caller's cwd", () => {
    expect(
      parseArgs(
        [
          "--",
          "--workspace",
          "ws-1",
          "--apply",
          "--only",
          "zzap,drom",
          "--from",
          "snap",
        ],
        "/repo",
      ),
    ).toEqual({
      workspaceId: "ws-1",
      apply: true,
      only: ["zzap", "drom"],
      from: "/repo/snap",
    })
  })

  it("rejects unknown channels and arguments", () => {
    expect(() => parseArgs(["--workspace", "ws", "--only", "vk"])).toThrow(
      "Unknown channel(s): vk",
    )
    expect(() => parseArgs(["--workspace", "ws", "--force"])).toThrow(
      "Unknown argument: --force",
    )
  })
})

describe("parseEnvFile", () => {
  it("skips comments and strips quotes and export", () => {
    expect(
      parseEnvFile("# x\nexport A='1'\nB=\"two=2\"\r\nC=\n\nbad line"),
    ).toEqual({ A: "1", B: "two=2", C: "" })
  })
})

describe("toDromCursor", () => {
  it("maps Geka's snake_case seconds state, tolerating missing fields", () => {
    expect(toDromCursor({ dialogs: { "101": {}, "102": null } })).toEqual({
      dialogs: {
        "101": {
          lastInboundId: "",
          lastMessageDate: 0,
          seenDealIds: [],
          fetchedDealUrls: [],
          updatedAt: 0,
        },
        "102": {
          lastInboundId: "",
          lastMessageDate: 0,
          seenDealIds: [],
          fetchedDealUrls: [],
          updatedAt: 0,
        },
      },
    })
    expect(toDromCursor("garbage")).toEqual({ dialogs: {} })
  })
})

describe("runGekaImport", () => {
  it("dry run writes nothing, calls nothing and masks every secret", async () => {
    const { deps, importFromAuth } = makeDeps()

    const report = await runGekaImport(options(), deps)
    const text = report.lines.join("\n")

    expect(report.failed).toBe(0)
    expect(text).toContain("dry run, nothing is written")
    expect(text).toContain("seller 12345678")
    expect(text).toContain("cursor 2 dialogs from Geka")
    for (const secret of [MAX_TOKEN, ZZAP_KEY, COOKIE_VALUE, "hook-secret"]) {
      expect(text).not.toContain(secret)
    }
    expect(importFromAuth).not.toHaveBeenCalled()
    expect(deps.resolveMaxAuth).not.toHaveBeenCalled()
  })

  it("--apply imports each channel with its auth and initial cursor", async () => {
    const { deps, importFromAuth } = makeDeps()

    const report = await runGekaImport(options({ apply: true }), deps)

    expect(report.failed).toBe(0)
    expect(deps.resolveMaxAuth).toHaveBeenCalledWith({
      secretText: MAX_TOKEN,
      webhookSecret: "hook-secret",
    })
    expect(importFromAuth).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-1",
      provider: "max",
      auth: { secretText: MAX_TOKEN, webhookSecret: "hook-secret", botId: "1" },
    })
    expect(importFromAuth).toHaveBeenNthCalledWith(2, {
      workspaceId: "ws-1",
      provider: "zzap",
      auth: {
        secretText: ZZAP_KEY,
        codeObject: "-1",
        typeObject: "0",
        testMode: false,
        pollIntervalSeconds: 180,
        maxThreadsPerPoll: 5,
        requestMinIntervalSeconds: 3.5,
        kind: "zzap",
      },
      pollCursor: null,
    })
    const dromCall = importFromAuth.mock.calls[2]?.[0]
    expect(dromCall?.auth).toEqual({
      secretText: expect.stringContaining(COOKIE_VALUE),
      sellerLogin: "12345678",
      pollIntervalSeconds: undefined,
      kind: "drom",
    })
    expect(dromCall?.pollCursor).toEqual({
      dialogs: {
        "101": {
          lastInboundId: "555",
          lastMessageDate: 1_792_000_000,
          seenDealIds: ["d1", "7"],
          fetchedDealUrls: ["https://baza.drom.ru/personal/deal/1"],
          updatedAt: 1_792_400_000_000,
        },
        "102": {
          lastInboundId: "",
          lastMessageDate: 0,
          seenDealIds: [],
          fetchedDealUrls: [],
          updatedAt: 1_792_400_001_000,
        },
      },
    })
    expect(report.lines.join("\n")).toContain(
      "created, paused (connection conn-drom)",
    )
  })

  it("reports an enabled channel as kept on a re-run", async () => {
    const { deps, importFromAuth } = makeDeps()
    importFromAuth.mockResolvedValue({
      connection: { id: "conn-1" },
      outcome: "updatedAuth",
    })

    const report = await runGekaImport(
      options({ apply: true, only: ["zzap"] }),
      deps,
    )

    expect(report.lines.join("\n")).toContain(
      "channel is on: secrets replaced, status and cursor kept",
    )
  })

  it("reads only --from and keeps going when one channel fails", async () => {
    rmSync(join(dir, "max.env"))
    const { deps, importFromAuth } = makeDeps()
    const onError = vi.fn()

    const report = await runGekaImport(options({ apply: true }), deps, onError)

    expect(report.failed).toBe(1)
    expect(report.lines.join("\n")).toContain(
      `max: FAILED — max.env not found in ${dir}`,
    )
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "max")
    expect(importFromAuth).toHaveBeenCalledTimes(2)
  })

  it("fails a channel whose required value is empty", async () => {
    writeFileSync(join(dir, "drom.env"), "DROM_SELLER_LOGIN=\n")
    const { deps } = makeDeps()

    const report = await runGekaImport(options({ only: ["drom"] }), deps)

    expect(report.failed).toBe(1)
    expect(report.lines.join("\n")).toContain(
      "DROM_SELLER_LOGIN is empty in drom.env",
    )
  })
})
