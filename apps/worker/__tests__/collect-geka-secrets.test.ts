import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const SCRIPT = fileURLToPath(
  new URL("../../../scripts/collect-geka-secrets.sh", import.meta.url),
)
const MAX_TOKEN = "max-token-0123456789abcdef-SECRET"
const ZZAP_KEY = "zzap-key-0123456789abcdef-SECRET"

let sources: string
let dest: string

const run = (args: string[] = [], env: Record<string, string> = {}) =>
  spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GEKA_ENV_FILE: join(sources, "geka.env"),
      DASHBOARD_ENV_FILE: join(sources, "dashboard.env"),
      GEKA_DROM_COOKIES: join(sources, "cookies.json"),
      GEKA_DROM_STATE: join(sources, "state.json"),
      GEKA_DEST: dest,
      ...env,
    },
  })

const read = (name: string) => readFileSync(join(dest, name), "utf8")
const mode = (path: string) => statSync(path).mode % 0o1000

beforeEach(() => {
  sources = mkdtempSync(join(tmpdir(), "geka-src-"))
  dest = join(mkdtempSync(join(tmpdir(), "geka-dest-")), "geka")
  writeFileSync(
    join(sources, "geka.env"),
    `OTHER=1\nMAX_BOT_TOKEN="${MAX_TOKEN}"\nMAX_WEBHOOK_SECRET=hook-secret\n`,
  )
  writeFileSync(
    join(sources, "dashboard.env"),
    `ZZAP_API_KEY=${ZZAP_KEY}\nZZAP_POLL_INTERVAL_SECONDS=180\nZZAP_MAX_THREADS_PER_POLL=5\n`,
  )
  writeFileSync(
    join(sources, "cookies.json"),
    JSON.stringify([
      { name: "ring", value: "x" },
      { name: "login", value: "12345678" },
    ]),
  )
  writeFileSync(join(sources, "state.json"), JSON.stringify({ dialogs: {} }))
})

afterEach(() => {
  rmSync(sources, { recursive: true, force: true })
  rmSync(join(dest, ".."), { recursive: true, force: true })
})

describe("collect-geka-secrets.sh", () => {
  it("copies every source into private files and prints no secret", () => {
    const result = run()

    expect(result.status).toBe(0)
    expect(mode(dest)).toBe(0o700)
    for (const name of [
      "max.env",
      "zzap.env",
      "drom.env",
      "drom-cookies.json",
      "drom-state.json",
      "README.md",
    ]) {
      expect(mode(join(dest, name))).toBe(0o600)
    }
    expect(read("max.env")).toContain(`MAX_BOT_TOKEN=${MAX_TOKEN}\n`)
    expect(read("max.env")).toContain("MAX_WEBHOOK_SECRET=hook-secret\n")
    expect(read("zzap.env")).toContain(`ZZAP_API_KEY=${ZZAP_KEY}\n`)
    expect(read("zzap.env")).toContain("CODE_OBJECT=-1\nTYPE_OBJECT=0\n")
    expect(read("zzap.env")).toContain("POLL_INTERVAL_SECONDS=180\n")
    expect(read("drom.env")).toContain("DROM_SELLER_LOGIN=12345678\n")
    expect(read("drom-cookies.json")).toBe(
      readFileSync(join(sources, "cookies.json"), "utf8"),
    )
    const output = result.stdout + result.stderr
    for (const secret of [MAX_TOKEN, ZZAP_KEY, "hook-secret"]) {
      expect(output).not.toContain(secret)
    }
    expect(output).toContain("max-…CRET")
  })

  it("keeps existing files unless --force", () => {
    run()
    writeFileSync(
      join(sources, "geka.env"),
      "MAX_BOT_TOKEN=new-token-0123456789abcdef\n",
    )

    expect(run().stdout).toContain("max.env: kept")
    expect(read("max.env")).toContain(MAX_TOKEN)

    expect(run(["--force"]).stdout).toContain("max.env: written")
    expect(read("max.env")).toContain(
      "MAX_BOT_TOKEN=new-token-0123456789abcdef",
    )
    expect(mode(join(dest, "max.env"))).toBe(0o600)
  })

  it("warns about a missing source and still collects the rest", () => {
    rmSync(join(sources, "dashboard.env"))

    const result = run()

    expect(result.status).toBe(0)
    expect(result.stderr).toContain("zzap.env skipped")
    expect(existsSync(join(dest, "zzap.env"))).toBe(false)
    expect(existsSync(join(dest, "max.env"))).toBe(true)
  })

  it("lets DROM_SELLER_LOGIN override the login cookie", () => {
    run([], { DROM_SELLER_LOGIN: "seller-x" })

    expect(read("drom.env")).toContain("DROM_SELLER_LOGIN=seller-x\n")
  })

  it("leaves the sources untouched", () => {
    const before = readFileSync(join(sources, "geka.env"), "utf8")
    run(["--force"])
    expect(readFileSync(join(sources, "geka.env"), "utf8")).toBe(before)
  })
})
