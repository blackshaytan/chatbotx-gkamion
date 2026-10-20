import { readFileSync, writeFileSync } from "node:fs"
import {
  buildCatalogLike,
  type Catalog,
  type FlatCatalog,
  flattenCatalog,
  listPendingKeys,
  mergeTranslations,
} from "./catalog"
import { isRuBatchId, ruBatches } from "./ru-batches"

const englishUrl = new URL("../../messages/en.json", import.meta.url)
const russianUrl = new URL("../../messages/ru.json", import.meta.url)
const sameAsEnglishUrl = new URL(
  "../../__tests__/fixtures/ru-same-as-english.json",
  import.meta.url,
)

const readJson = <T>(url: URL | string): T =>
  JSON.parse(readFileSync(url, "utf8")) as T

const writeJson = (url: URL, value: unknown) => {
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`)
}

const englishCatalog = readJson<Catalog>(englishUrl)
const english = flattenCatalog(englishCatalog)
const russian = flattenCatalog(readJson<Catalog>(russianUrl))
const sameAsEnglish = readJson<string[]>(sameAsEnglishUrl)

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const pendingFor = (sections: readonly string[]) =>
  listPendingKeys({
    english,
    target: russian,
    sameAsEnglish: new Set(sameAsEnglish),
    sections,
  })

const printPending = (batchId: string | undefined, limitArg?: string) => {
  if (!(batchId && isRuBatchId(batchId))) {
    return fail(
      `Unknown batch. Use one of: ${Object.keys(ruBatches).join(", ")}`,
    )
  }
  const limit = limitArg ? Number(limitArg) : Number.POSITIVE_INFINITY
  const keys = pendingFor(ruBatches[batchId]).slice(0, limit)
  const subset: FlatCatalog = Object.fromEntries(
    keys.map((key) => [key, english[key] ?? ""]),
  )
  process.stdout.write(
    `${JSON.stringify(buildCatalogLike(englishCatalog, subset), null, 2)}\n`,
  )
}

const mergeFile = (file: string | undefined, isDryRun: boolean) => {
  if (!file) {
    return fail("Usage: merge|check <translated.json>")
  }
  const result = mergeTranslations({
    english,
    target: russian,
    sameAsEnglish,
    translations: flattenCatalog(readJson<Catalog>(file)),
  })
  if (result.errors.length > 0) {
    return fail(result.errors.join("\n"))
  }
  if (isDryRun) {
    process.stdout.write("OK.\n")
    return
  }
  writeJson(russianUrl, buildCatalogLike(englishCatalog, result.target))
  writeJson(sameAsEnglishUrl, result.sameAsEnglish)
  process.stdout.write("Merged.\n")
}

const printStatus = () => {
  for (const [batchId, sections] of Object.entries(ruBatches)) {
    const total = Object.keys(english).filter((key) =>
      (sections as readonly string[]).includes(key.split(".")[0] ?? ""),
    ).length
    const pending = pendingFor(sections).length
    process.stdout.write(`${batchId}: ${total - pending}/${total}\n`)
  }
}

const [command, firstArg, ...rest] = process.argv.slice(2)
const limitIndex = rest.indexOf("--limit")
const limitArg = limitIndex === -1 ? undefined : rest[limitIndex + 1]

if (command === "pending") {
  printPending(firstArg, limitArg)
} else if (command === "merge" || command === "check") {
  mergeFile(firstArg, command === "check")
} else if (command === "status") {
  printStatus()
} else {
  fail(
    "Usage: i18n:ru pending <batch> [--limit N] | merge <file> | check <file> | status",
  )
}
