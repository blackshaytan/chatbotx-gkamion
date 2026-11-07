import { readFileSync } from "node:fs"
import { chromium } from "playwright"

const workspace = process.argv[2]
if (!workspace) {
  throw new Error("Usage: node chats-scroll-browser.mjs <workspace>")
}

const chatsPage = readFileSync(
  `${workspace}/apps/builder/src/features/chats/components/chats-page.tsx`,
  "utf8",
)
const layout = readFileSync(
  `${workspace}/apps/builder/src/app/space/[workspaceId]/layout.tsx`,
  "utf8",
)
const composer = readFileSync(
  `${workspace}/apps/builder/src/features/chats/components/chat-composer.tsx`,
  "utf8",
)

const requiredSnippets = [
  ["chats-page.tsx", chatsPage, "<FullBleed>"],
  [
    "chats-page.tsx",
    chatsPage,
    "lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden",
  ],
  ["chats-page.tsx", chatsPage, "lg:min-h-0 lg:flex-1 lg:overflow-y-auto"],
  ["chats-page.tsx", chatsPage, "min-h-0 flex-1 space-y-3 overflow-y-auto p-3"],
  ["layout.tsx", layout, "has-data-full-bleed:h-svh"],
  ["chat-composer.tsx", composer, "shrink-0 space-y-2 border-t p-3"],
]

for (const [name, source, snippet] of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`${name} no longer contains \`${snippet}\``)
  }
}

if (chatsPage.includes("min-h-[calc(100vh")) {
  throw new Error("chats page is floored with a viewport calc again")
}

const messages = Array.from(
  { length: 40 },
  (_, index) => `<p class="h-20">message ${index}</p>`,
).join("")

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  </head>
  <body class="m-0">
    <div data-testid="shell" class="flex min-h-svh w-full has-data-full-bleed:h-svh">
      <main class="relative flex w-full min-w-0 flex-1 flex-col">
        <main class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
          <div data-full-bleed class="-m-4 flex min-h-0 flex-1 flex-col md:-m-6">
            <div data-testid="grid" class="grid min-h-0 flex-1 gap-4 p-4 max-lg:overflow-y-auto md:p-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
              <aside data-testid="chat-column" class="rounded-md border lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
                <div data-testid="chat-column-header" class="flex shrink-0 items-center border-b p-3">Chats</div>
                <nav class="p-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                  <div class="px-3 py-2">Assistant</div>
                  <div class="px-3 py-2">Contact</div>
                </nav>
              </aside>
              <section class="flex flex-col rounded-md border lg:min-h-0 lg:overflow-hidden">
                <header class="flex shrink-0 border-b p-3">Dialog</header>
                <div data-testid="thread" class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">${messages}</div>
                <div data-testid="composer" class="shrink-0 border-t p-3"><div class="min-h-20"></div></div>
              </section>
            </div>
          </div>
        </main>
      </main>
    </div>
  </body>
</html>`

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

try {
  await page.setContent(html, { waitUntil: "load" })
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("[data-testid=grid]")).display ===
      "grid",
    { timeout: 30_000 },
  )

  const measured = await page.evaluate(() => {
    const shell = document
      .querySelector("[data-testid=shell]")
      .getBoundingClientRect()
    const column = document
      .querySelector("[data-testid=chat-column]")
      .getBoundingClientRect()
    const thread = document.querySelector("[data-testid=thread]")
    const composer = document
      .querySelector("[data-testid=composer]")
      .getBoundingClientRect()
    return {
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      shellHeight: shell.height,
      columnTop: column.top,
      columnBottom: column.bottom,
      threadScrollHeight: thread.scrollHeight,
      threadClientHeight: thread.clientHeight,
      composerTop: composer.top,
      composerBottom: composer.bottom,
      innerHeight: window.innerHeight,
    }
  })

  const failures = []
  if (measured.shellHeight > measured.innerHeight + 1) {
    failures.push(
      `shell is taller than the viewport (${measured.shellHeight} > ${measured.innerHeight})`,
    )
  }
  if (measured.documentScrollHeight > measured.documentClientHeight + 1) {
    failures.push(
      `the page itself scrolls (${measured.documentScrollHeight} > ${measured.documentClientHeight})`,
    )
  }
  if (measured.threadScrollHeight <= measured.threadClientHeight + 20) {
    failures.push("the dialog thread does not scroll internally")
  }
  if (
    measured.columnTop < -1 ||
    measured.columnBottom > measured.innerHeight + 1
  ) {
    failures.push(
      `the chat column is outside the viewport (${measured.columnTop}..${measured.columnBottom})`,
    )
  }
  if (
    measured.composerBottom > measured.innerHeight + 1 ||
    measured.composerTop < 0
  ) {
    failures.push("the composer is outside the viewport")
  }

  const columnTopBefore = measured.columnTop
  const threadBox = await page.locator("[data-testid=thread]").boundingBox()
  if (threadBox) {
    await page.mouse.move(threadBox.x + threadBox.width / 2, threadBox.y + 40)
    await page.mouse.wheel(0, 900)
  } else {
    failures.push("the dialog thread has no box")
  }

  const afterWheel = await page.evaluate(() => ({
    scrollY: window.scrollY,
    threadScrollTop: document.querySelector("[data-testid=thread]").scrollTop,
    columnTop: document
      .querySelector("[data-testid=chat-column]")
      .getBoundingClientRect().top,
  }))

  if (afterWheel.scrollY !== 0) {
    failures.push(
      `wheeling the dialog scrolled the page (${afterWheel.scrollY})`,
    )
  }
  if (afterWheel.threadScrollTop < 50) {
    failures.push(
      `wheeling the dialog did not scroll the thread (${afterWheel.threadScrollTop})`,
    )
  }
  if (Math.abs(afterWheel.columnTop - columnTopBefore) > 1) {
    failures.push("wheeling the dialog moved the chat column")
  }

  if (failures.length) {
    throw new Error(failures.join("\n"))
  }

  console.log(
    JSON.stringify(
      {
        documentClientHeight: measured.documentClientHeight,
        documentScrollHeight: measured.documentScrollHeight,
        threadScrollTop: afterWheel.threadScrollTop,
        columnTop: afterWheel.columnTop,
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
}
