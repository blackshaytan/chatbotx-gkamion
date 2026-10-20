import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"

const repoRoot = new URL("../../../../", import.meta.url).pathname
const scanRoots = ["apps/builder/src", "packages/ui/src"]
const textAttributes = new Set([
  "aria-label",
  "alt",
  "label",
  "placeholder",
  "title",
  "description",
  "emptyMessage",
  "tooltip",
])
const textProperties = new Set([
  "header",
  "label",
  "placeholder",
  "title",
  "description",
])
const englishPattern = /[A-Za-z]{2,}/
const ignoredPathPattern = /(__tests__|\.test\.|\.stories\.|\/stories\/)/

export type HardcodedString = {
  file: string
  line: number
  kind: "jsx-text" | "attribute" | "property" | "toast"
  text: string
}

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      return listSourceFiles(path)
    }
    return path.endsWith(".tsx") || path.endsWith(".ts") ? [path] : []
  })

const isEnglishText = (text: string) => englishPattern.test(text.trim())

const isToastCall = (node: ts.CallExpression) => {
  const expression = node.expression
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "toast"
  )
}

export const findHardcodedStrings = (
  fileName: string,
  source: string,
): HardcodedString[] => {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const results: HardcodedString[] = []
  const add = (node: ts.Node, kind: HardcodedString["kind"], text: string) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
    results.push({ file: fileName, line: line + 1, kind, text: text.trim() })
  }
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && isEnglishText(node.text)) {
      add(node, "jsx-text", node.text.replace(/\s+/g, " "))
    }
    if (
      ts.isJsxAttribute(node) &&
      textAttributes.has(node.name.getText(sourceFile)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      isEnglishText(node.initializer.text)
    ) {
      add(node, "attribute", node.initializer.text)
    }
    if (
      ts.isPropertyAssignment(node) &&
      textProperties.has(node.name.getText(sourceFile)) &&
      ts.isStringLiteral(node.initializer) &&
      isEnglishText(node.initializer.text)
    ) {
      add(node, "property", node.initializer.text)
    }
    if (ts.isCallExpression(node) && isToastCall(node)) {
      const [message] = node.arguments
      if (
        message &&
        ts.isStringLiteral(message) &&
        isEnglishText(message.text)
      ) {
        add(node, "toast", message.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return results
}

const scanRepository = () =>
  scanRoots
    .flatMap((root) => listSourceFiles(join(repoRoot, root)))
    .filter((path) => !ignoredPathPattern.test(path))
    .flatMap((path) =>
      findHardcodedStrings(
        relative(repoRoot, path),
        readFileSync(path, "utf8"),
      ),
    )

if (process.argv[1]?.endsWith("find-hardcoded.ts")) {
  const results = scanRepository()
  for (const result of results) {
    process.stdout.write(
      `${result.file}:${result.line}\t${result.kind}\t${result.text}\n`,
    )
  }
  process.stderr.write(`${results.length} hardcoded strings\n`)
}
