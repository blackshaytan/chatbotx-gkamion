# DROM channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the DROM (baza.drom.ru) seller chat as a ChatbotX channel that receives buyer messages by polling and replies with text and photos. The channel is created switched off.

**Architecture:** DROM has no official chat API; Geka drives the seller web chat with the seller's cookies (`/GKamion/chat-bot/scripts/drom_messaging.py`, read only). `integrations/drom` ports that client to TypeScript and plugs into the poll framework from Plan 2 (`ConnectionPoll`, `ConnectionPollState`, `runPoll`). Text-only rendering (buttons as a numbered list, long text split) and the per-key request spacer move from `integrations/zzap` into the SDK so both text channels share them.

**Tech Stack:** TypeScript, ky, zod, vitest + msw, Drizzle/Postgres, Next.js builder.

## Global Constraints

- Channels start `paused` (`startsPaused: true`); nothing in this plan switches a channel on.
- Never touch Geka, n8n, Dashboard, tmtr-runner or their containers/databases. Geka sources are read only as reference.
- `db:migrate` is never run without the user's explicit approval; migrations are generated and shown.
- No real external calls in tests (msw / vi.mock). HTML fixtures are anonymized (no real names, phones, e-mails, deal ids).
- Log errors with `{ err }`; no `console` in server code.
- No dynamic `import()` in `packages/*`, `integrations/*`, `apps/worker`.
- App code → service → repository; `packages/connections` may call repositories but never raw `db`.
- Every new builder action goes into `apps/builder/__tests__/api-parity-manifest.json` at its sorted position.
- Every new i18n key goes into all 21 `apps/builder/messages/*.json` (English text; Russian arrives in Plan 5).
- Stage specific files only (`git add <paths>`), never `-A`/`.`.
- PATH: `export PATH=/GKamion/chatbotX/.tools/node-24/bin:$PATH`. Builder tsc: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .`; other packages 6144; at most two tsc runs in parallel.

## Deviations from the spec (`docs/superpowers/specs/2026-10-17-ru-channels-max-zzap-drom-design.md`)

1. §2 contact id `drom:<interlocutor>` → contact `sourceId` = the raw DROM `dialogId`. Outgoing messages are addressed by `dialogId`, and one buyer can have several dialogs (one per listing). The interlocutor login is kept as `sourceUsername`; Plan 4 maps Geka sessions through Geka's `poll-state.json` (`dialogs[dialogId].interlocutor`).
2. §4.3 cursor columns in `IntegrationDrom` → `ConnectionPollState.cursor` (as decided in Plan 2). `IntegrationDrom` keeps only `sellerLogin` as identity.
3. Seller identity: the protocol exposes no seller id, so the connect form asks for the seller login (`sellerLogin`), used as the connection identity and display name.
4. Cookie refresh: no new endpoint. Connecting again with the same `sellerLogin` while the channel is off or `needs_reauth` replaces the cookies in place (existing `connectFromCredentials` revive path, same inbox). The settings row gets an "Update cookies" button that opens the connect form with the login prefilled.
5. Listing and deal data travel in `message.contentAttributes.dromContext` (`listing`, `deal`); the deal also enriches the contact (name, phone, e-mail). Geka's bulletin enrichment (OEM number/brand per deal item) and auto-checkout are out of scope — they are Geka business logic, not channel transport.
6. Text limit 4000 per message (DROM publishes none; Geka sends unsplit text). Request spacing 1 s per seller (Geka has none).

## File map

| File | Responsibility |
|---|---|
| `packages/sdk/src/lib/shared/request-lane.ts` | `acquireRequestSlot` — per-key request spacing (moved from zzap) |
| `packages/sdk/src/lib/shared/text-channel.ts` | flow step / message → plain text lines (moved from zzap) |
| `packages/database/src/schema/integration-drom.ts` | `IntegrationDrom` table |
| `integrations/drom/src/lib/cookies.ts` | Cookie-Editor / Playwright JSON or raw header → `Cookie` header |
| `integrations/drom/src/lib/http-client.ts` | cookie session client, charset, session-expired detection |
| `integrations/drom/src/parse/*` | HTML/JSON parsers (view, brief, deal, images) |
| `integrations/drom/src/apis/*` | inbox, dialog view, send, upload, image, deal |
| `integrations/drom/src/handlers/poll.ts` | `pollDrom` |
| `integrations/drom/src/handlers/message/*` | receive / send |
| `integrations/drom/src/integration.ts` | provider definition |
| `packages/business/src/integration-drom/` | settings listing service |
| `apps/builder/src/features/integration-drom/**` | connect / update cookies / switch / disconnect UI |

---

### Task 1: Shared text-channel helpers and request lane in the SDK

**Files:**
- Create: `packages/sdk/src/lib/shared/request-lane.ts`, `packages/sdk/src/lib/shared/text-channel.ts`, `packages/sdk/__tests__/text-channel.test.ts`, `packages/sdk/__tests__/request-lane.test.ts`
- Modify: `packages/sdk/src/lib/shared/index.ts` (export both)
- Modify: `integrations/zzap/src/lib/http-client.ts` (use `acquireRequestSlot`), `integrations/zzap/src/handlers/message/outgoing-message.ts` (use `flowStepToTextOutgoing`, `messageToTextOutgoing`, `renderTextOutgoing`)
- Delete: `integrations/zzap/src/lib/rate-limiter.ts`, `integrations/zzap/src/handlers/message/to-zzap-text.ts`; move their tests' cases into the SDK tests and keep `integrations/zzap/__tests__/messages.test.ts` sending tests unchanged.

**Interfaces — Produces:**

```ts
// request-lane.ts
export const acquireRequestSlot: (key: string, minIntervalMs: number) => Promise<() => void>

// text-channel.ts
export type TextChannelButton = { label: string; url?: string }
export type TextChannelMedia = { url: string; filename?: string }
export type TextChannelOutgoing = { text?: string; media?: TextChannelMedia[]; buttons?: TextChannelButton[] }
export const textHandledFlowStepTypes: readonly ["sendText", "sendImage", "sendFile", "sendQuickReply"]
export const fromFlowButton: (button: ButtonStepProps) => TextChannelButton
export const fromTemplateButton: (button: MessageButtonTemplate) => TextChannelButton
export const flowStepToTextOutgoing: (step: SendFlowStepData["step"], quickReplies?: MessageButtonTemplate[] | null) => TextChannelOutgoing
export const messageToTextOutgoing: (message: { text?: string | null; attachments?: { url?: string | null; name?: string | null }[] | null }, quickReplies?: MessageButtonTemplate[] | null) => TextChannelOutgoing
export const splitTextAtLines: (text: string, limit: number) => string[]
/** media rendered as links (ZZAP). */
export const renderTextOutgoing: (outgoing: TextChannelOutgoing, limit: number) => string[]
/** text + buttons only, media left to the caller (DROM uploads photos). */
export const renderTextAndButtons: (outgoing: Omit<TextChannelOutgoing, "media">, limit: number) => string[]
```

- [ ] **Step 1:** Move `acquireZzapSlot` verbatim into `request-lane.ts` as `acquireRequestSlot` (doc comment: "Serialises requests of one key … Process-local."). Test: two acquisitions of one key with `minIntervalMs = 50` — the second resolves ≥ 50 ms after the first `release()`; different keys don't wait (fake timers).
- [ ] **Step 2:** Move `fromFlowButton`, `fromTemplateButton`, `splitZzapText` (→ `splitTextAtLines(text, limit)`), `toZzapTexts` (→ `renderTextOutgoing(outgoing, limit)`) and the `stepToOutgoing` switch from zzap `outgoing-message.ts` (→ `flowStepToTextOutgoing`) into `text-channel.ts`; `renderTextAndButtons` = `renderTextOutgoing({ text, buttons }, limit)`. Unsupported step types throw `new Error(\`Unsupported text channel flow step: ${step.stepType}\`)`. Port the five `toZzapTexts` tests to `packages/sdk/__tests__/text-channel.test.ts` with `limit` 4000 and add one `flowStepToTextOutgoing` test per step type.
- [ ] **Step 3:** ZZAP: `http-client.ts` imports `acquireRequestSlot` from `@chatbotx.io/sdk`; `outgoing-message.ts` builds `flowStepToTextOutgoing(props.data.step, props.data.quickReplies)` / `messageToTextOutgoing(message, quickReplies)` and sends `renderTextOutgoing(outgoing, ZZAP_TEXT_LIMIT)`; `handledFlowStepTypes = textHandledFlowStepTypes`. Delete the two moved files and their now-dead tests.
- [ ] **Step 4:** `cd packages/sdk && npx vitest run && npx tsc --noEmit -p .`; `cd integrations/zzap && npx vitest run && npx tsc --noEmit -p .` → PASS. `npx ultracite check packages/sdk integrations/zzap`.
- [ ] **Step 5: Commit** `refactor(sdk): share text-channel rendering and request spacing between ZZAP and DROM`

---

### Task 2: Register `drom` as a channel (enums, table, records)

Mirror commit `2c3841f42` (`git show 2c3841f42 --stat`) — same files, value `drom`.

**Files:**
- Modify: `packages/utils/src/channel.ts` (`channelTypes` add `"drom"` after `"zzap"`; `CHANNEL_CAPABILITIES.drom = { creatable: true, manageable: true, requiresCredential: false, order: 9, callable: false, pausable: true }`; shift following `order` values by 1)
- Modify: `packages/database/src/partials/integration.ts` (`"drom"` in `integrationTypes`, alphabetical position)
- Create: `packages/database/src/schema/integration-drom.ts` (= `integration-zzap.ts` with `IntegrationDrom`, column `sellerLogin` instead of `codeObject`, indexes `IntegrationDrom_workspaceId_idx`, `IntegrationDrom_inboxId_key`, `IntegrationDrom_sellerLogin_key`), `relations/integration-drom.ts`; Modify `schema/index.ts`, `relations/index.ts` (import AND spread), `types.ts` (`IntegrationDromModel`)
- Create: `packages/flow-config/src/channel-rules/policies/drom.ts` (= zzap policy: `text: 4000`, `buttonCount: 10`, `buttonLabel: 64`, supported `sendText`, `sendImage`, `sendFile`, `sendQuickReply`; comment "DROM chat: text and photos; buttons and quick replies are sent as a numbered list."); register it; tests: `MEDIA_SUPPORT_BY_CHANNEL.drom` (read from a first run), `TEXT_LIMITS.drom = 4000`, `send-view-catalog-step.test.ts` `drom: stepSupport.unsupported`
- Modify the records (`drom` entry next to `zzap`):
  - `channel-identity.ts`: `{ labelKey: "fields.channelIdentity.dromDialogId", hideWhenSourceUserIdKeyed: false }`
  - `inbox-icon.tsx`: `{ Icon: CarIcon, iconClassName: "stroke-[#DB2828]", defaultLabelKey: "fields.drom.label" }`
  - `inbox-hook.ts`: `{ label: "DROM", value: "drom" }`
  - `message-input.tsx`: `drom: 0`
  - `refresh-channel-tokens.ts`: `drom: undefined`
  - `contact-inbox-identity.ts`: same two entries as `zzap` with `"drom"`
  - `profile-refresh/rules.ts`: `drom: { inbound: "payload", onDemand: false }, // deal page carries buyer name/phone/email`
  - `inbox/utils.ts`: same as `zzap` (`undefined` / `""`)
  - `error-log.ts`: `drom: "DROM"`
  - `inbound-webhook-channel.ts`: `drom: noInboxIdentifiers` (like `zzap`)
  - `packages/connections/src/registry.ts`: `drom: null` (replaced in Task 6)
- Modify: 21 × `apps/builder/messages/*.json`: `fields.drom = { label: "DROM" }` after `fields.zzap`, `fields.channelIdentity.dromDialogId = "DROM dialog id"` after `zzapUserKey` (same node script as Plan 2 Task 4; `git diff --stat` must show only insertions)

- [ ] **Step 1:** Table + relations + types; flow policy + tests.
- [ ] **Step 2:** Records; run builder, business, worker, flow-config tsc (two at a time) and fix every remaining `Record<ChannelType…>` hit.
- [ ] **Step 3:** i18n; `pnpm --filter builder i18n:check` → PASS.
- [ ] **Step 4: Migration (do NOT apply).** `cd packages/database && DATABASE_URL=postgres://x:x@127.0.0.1:1/x pnpm make:migration integration_drom && pnpm db:check-drift` → `CREATE TABLE "IntegrationDrom"` + 3 indexes + 2 FKs.
- [ ] **Step 5:** `flow-config`, `utils`, `business` tests → PASS.
- [ ] **Step 6: Commit** `feat(drom): add IntegrationDrom table and register drom in every channel record`

---

### Task 3: `integrations/drom` — package, cookies, HTTP client

**Files:**
- Create: `integrations/drom/{package.json,tsconfig.json,vitest.config.ts}` (copy `integrations/zzap`, name `@chatbotx.io/integration-drom`)
- Create: `src/constants.ts`, `src/schema.ts`, `src/exception.ts`, `src/lib/{cookies.ts,http-client.ts,error-mapper.ts,logger.ts}`
- Test: `__tests__/fixtures.ts`, `__tests__/cookies.test.ts`, `__tests__/http-client.test.ts`

**Interfaces — Produces:**

```ts
// constants.ts
export const DROM_BASE_URL = "https://baza.drom.ru"
export const DROM_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
export const DROM_TEXT_LIMIT = 4000
export const DROM_MAX_IMAGES_PER_MESSAGE = 8
export const DROM_MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const DROM_REQUEST_TIMEOUT_MS = 45_000
export const DROM_UPLOAD_TIMEOUT_MS = 90_000
export const DROM_MIN_POLL_INTERVAL_SECONDS = 15
export const DROM_DEFAULTS = { pollIntervalSeconds: 30, maxDialogsPerPoll: 5, requestMinIntervalSeconds: 1 } as const

// schema.ts
export type DromAuthValue = SecretTextAuthValue & {   // secretText = Cookie header
  sellerLogin: string
  pollIntervalSeconds: number
  maxDialogsPerPoll: number
  requestMinIntervalSeconds: number
}
export type DromCredentialsInput = { secretText: string; sellerLogin: string; pollIntervalSeconds?: number; maxDialogsPerPoll?: number; requestMinIntervalSeconds?: number }
export type DromConfig = BaseConfig

// exception.ts
export class DromException extends SdkException            // (message, httpStatusCode = 400, code = "dromError")
export class DromAPIException extends DromException        // HTTP / protocol failures
export class DromSessionExpiredException extends DromException // 401, code "dromSessionExpired"

// lib/cookies.ts
export const toCookieHeader: (input: string) => string   // throws DromException("cookiesInvalid") when nothing usable

// lib/http-client.ts
export type DromClient = {
  getJson: <T>(path: string, opts?: { referer?: string }) => Promise<T>
  getHtml: (url: string, opts?: { referer?: string }) => Promise<string>
  postForm: <T>(path: string, form: Record<string, string>, opts?: { referer?: string; utfFields?: string }) => Promise<T>
  postMultipart: <T>(path: string, field: string, file: { name: string; mime: string; bytes: Uint8Array }) => Promise<T>
  getBinary: (url: string) => Promise<{ bytes: Uint8Array; mime: string }>
}
export const createDromClient: (auth: DromAuthValue) => DromClient

// lib/error-mapper.ts
export const isRevokedTokenError: (err: unknown) => boolean   // DromSessionExpiredException or status 401/403
export const mapToChannelError: (err: unknown) => ChannelError
```

- [ ] **Step 1: Cookies test** (`cookies.test.ts`):

```ts
import { describe, expect, test } from "vitest"
import { toCookieHeader } from "../src/lib/cookies"

describe("toCookieHeader", () => {
  test("Cookie-Editor JSON array", () => {
    expect(
      toCookieHeader(JSON.stringify([
        { name: "ring", value: "abc", domain: ".drom.ru" },
        { name: "boobs", value: "x y", domain: ".drom.ru" },
        { name: "", value: "skip" },
      ])),
    ).toBe("ring=abc; boobs=x y")
  })
  test("Playwright storage state", () => {
    expect(toCookieHeader(JSON.stringify({ cookies: [{ name: "a", value: "1" }] }))).toBe("a=1")
  })
  test("raw Cookie header passes through trimmed", () => {
    expect(toCookieHeader("  a=1; b=2 ")).toBe("a=1; b=2")
  })
  test("garbage is rejected", () => {
    expect(() => toCookieHeader("[]")).toThrow("cookies")
    expect(() => toCookieHeader("hello")).toThrow("cookies")
  })
})
```

- [ ] **Step 2: Implement `cookies.ts`:**

```ts
import { DromException } from "../exception"

type RawCookie = { name?: unknown; value?: unknown }

const fromList = (list: unknown[]): string =>
  list
    .filter((item): item is RawCookie => typeof item === "object" && item !== null)
    .filter((item) => typeof item.name === "string" && item.name.length > 0)
    .map((item) => `${item.name}=${typeof item.value === "string" ? item.value : ""}`)
    .join("; ")

const RAW_HEADER = /^[^=;\s]+=[^;]*(;\s*[^=;\s]+=[^;]*)*;?$/

/** Accepts Cookie-Editor / Playwright JSON or a raw `Cookie` header. */
export const toCookieHeader = (input: string): string => {
  const trimmed = input.trim()
  let header = ""
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed: unknown = JSON.parse(trimmed)
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as { cookies?: unknown[] }).cookies ?? [])
    header = fromList(list)
  } else if (RAW_HEADER.test(trimmed)) {
    header = trimmed
  }
  if (!header) {
    throw new DromException("DROM cookies are empty or invalid", 400, "cookiesInvalid")
  }
  return header
}
```

(JSON.parse errors are caught and rethrown as the same `DromException`.)

- [ ] **Step 3: HTTP client tests** (`http-client.test.ts`, msw, `vi.mock("../src/constants")` not needed — set `requestMinIntervalSeconds: 0` in the fixture auth):
  - `getJson` sends `Cookie`, `User-Agent`, `X-Requested-With: XMLHttpRequest`, `Origin`, default `Referer` `${DROM_BASE_URL}/personal/messaging-modal?switchPosition=dialogs`, and returns parsed JSON.
  - `getJson` on an HTML body (login page) → `DromSessionExpiredException`.
  - 401 / 403 → `DromSessionExpiredException`; 500 → `DromAPIException` with `httpStatusCode` 500.
  - `getHtml` decodes `windows-1251` when the content type says so (fixture: `new TextEncoder` can't encode 1251 — build bytes with a small table for "Заказ": `[0xc7,0xe0,0xea,0xe0,0xe7]`) and defaults to windows-1251 when no charset is sent; honours `charset=utf-8`.
  - `getHtml` whose final URL path starts with `/sign` → `DromSessionExpiredException` (msw: respond 302 `Location: https://my.drom.ru/sign?return=…`, and a handler for that URL returning HTML).
  - `postForm` sends `application/x-www-form-urlencoded; charset=UTF-8`, `X-Utf-Fields: message`, body `message=%D0%9F…&images%5B7%5D=1`.
  - `postMultipart` sends `multipart/form-data` with field `up[]` and the file name.
  - `getBinary` rejects bodies over `DROM_MAX_IMAGE_BYTES` (mock the constant to 4) with `DromAPIException`.

- [ ] **Step 4: Implement `http-client.ts`** with ky (`baseUrl: DROM_BASE_URL`, `throwHttpErrors: false`, `timeout`, `retry: 0`), every request wrapped in `acquireRequestSlot(\`drom:${auth.sellerLogin}\`, auth.requestMinIntervalSeconds * 1000)` and released in `finally`. Helpers:

```ts
const SIGN_IN_PATH = /^\/sign/
const charsetOf = (contentType: string | null): string =>
  /charset=([\w-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase() ?? "windows-1251"

const decode = (bytes: ArrayBuffer, contentType: string | null): string => {
  const charset = charsetOf(contentType)
  return new TextDecoder(charset === "cp1251" ? "windows-1251" : charset).decode(bytes)
}

const ensureSession = (response: Response): void => {
  if (response.status === 401 || response.status === 403) {
    throw new DromSessionExpiredException(`DROM rejected the session (HTTP ${response.status})`)
  }
  if (SIGN_IN_PATH.test(new URL(response.url).pathname)) {
    throw new DromSessionExpiredException("DROM redirected to the sign-in page")
  }
  if (!response.ok) {
    throw new DromAPIException(`DROM HTTP ${response.status}`, response.status)
  }
}
```

`getJson`: `ensureSession`, decode as UTF-8, if the text does not start with `{`/`[` throw `DromSessionExpiredException("DROM answered HTML instead of JSON — cookies expired")`, else `JSON.parse`. `getHtml`: `ensureSession`, `decode`. `postForm`: body `new URLSearchParams(form).toString()`, headers above, response handled like `getJson`. `postMultipart`: `FormData` with `new Blob([bytes], { type: mime })` under `field`, timeout `DROM_UPLOAD_TIMEOUT_MS`. `getBinary`: absolute URL, headers `Cookie`, `User-Agent`, `Referer: ${DROM_BASE_URL}/personal/messaging-modal`, `Accept: image/avif,image/webp,image/*,*/*;q=0.8`; size check; mime from `content-type` (default `application/octet-stream`).

- [ ] **Step 5:** `error-mapper.ts` = zzap's with `DromSessionExpiredException` → `ChannelErrorCategory.AUTH_FAILED` (code `dromSessionExpired`), other `DromException` → `UNKNOWN` with its message. `logger.ts` = zzap's with `module: "integration-drom"`.
- [ ] **Step 6:** `CI=true pnpm install --no-frozen-lockfile`; `cd integrations/drom && npx vitest run && npx tsc --noEmit -p .` → PASS; ultracite on `integrations/drom`.
- [ ] **Step 7: Commit** `feat(drom): add DROM cookie session client`

---

### Task 4: Parsers with anonymized fixtures

Port `parse_view`, `normalize_brief`, `parse_message_images`, `is_drom_image_url`, `parse_deal_html`, `parse_price_from_title`, `strip_tags`, `span_inners_by_class` from `drom_messaging.py` (lines 147–624, 829–995) one to one.

**Files:**
- Create: `integrations/drom/src/parse/{html.ts,images.ts,brief.ts,view.ts,deal.ts,index.ts}`
- Create: `integrations/drom/__tests__/fixtures/{view-deal-then-chat.html,view-listing-header.html,view-images.html,deal-cdek.html,deal-pickup.html}` — rebuilt from the structure of Geka's `scripts/drom_order_fixtures/*.slim.html` and `test_drom_parse_view.py` with invented data (buyer "Иван Тестов", phone "+7 900 000-00-01", e-mail "buyer@example.test", deal id 10000001, city "Тестоград")
- Test: `integrations/drom/__tests__/parse.test.ts`

**Interfaces — Produces:**

```ts
// parse/html.ts
export const stripTags: (html: string) => string            // <br> → \n, tags removed, entities decoded, spaces collapsed, trimmed
export const spanInnersByClass: (html: string, className: string) => string[] // nested spans kept
export const decodeEntities: (text: string) => string        // named (&nbsp; &laquo; &raquo; &amp; &lt; &gt; &quot; &#39;) + numeric

// parse/images.ts
export type DromImage = { url: string; origUrl: string }
export const isDromImageUrl: (url: string) => boolean        // https only; static.baza.drom.ru/*, baza.drom.ru/p-img/*; no "..", no userinfo, ≤ 1024 chars
export const parseMessageImages: (html: string) => DromImage[]

// parse/brief.ts
export type DromBrief = { dialogId: string; interlocutor: string; lastMessageDate: number; isUnread: boolean; highlighted: boolean }
export const parseBriefs: (inboxList: unknown) => DromBrief[]  // `briefs[]`, highlighted = html contains "dialog-brief_highlighted"

// parse/view.ts
export type DromMessage = { messageId: string; direction: "in" | "out" | "unknown"; time: string; text: string; images: DromImage[]; isDealSystem: boolean }
export type DromListing = { title: string; url: string | null; price: number | null }
export type DromView = { dialogId: string | null; latestMessageId: string | null; interlocutor: string; listing: DromListing | null; orderUrl: string | null; messages: DromMessage[] }
export const parseView: (view: { dialog?: string; header?: string; interlocutor?: string }) => DromView
export const parsePriceFromTitle: (title: string) => number | null

// parse/deal.ts
export type DromDealItem = { title: string; price: number | null; qty: number; url: string; annotation: string }
export type DromDeal = { dealId: string | null; orderUrl: string; buyerName: string; phone: string; email: string; city: string; deliveryMethod: string; pickupAddress: string; items: DromDealItem[] }
export const parseDeal: (html: string, orderUrl: string) => DromDeal
export const normalizeOrderUrl: (value: string) => string
```

- [ ] **Step 1: Tests** (`parse.test.ts`) — port every case of `test_drom_parse_view.py` (deal before chat, unknown direction not duplicated, listing header, nested OEM span) plus:
  - `parseView` reads `data-dialog-id`, `data-latest-msg-id`, the «Заказ» deal link and the item title from the `•` sub-title.
  - `parseMessageImages` keeps `data-orig-src`, drops foreign hosts and duplicates.
  - `isDromImageUrl`: true for `https://static.baza.drom.ru/a.jpg`, `https://baza.drom.ru/p-img/x`; false for `http://…`, `https://evil.test/p-img/x`, `https://baza.drom.ru/../x`, `https://u:p@baza.drom.ru/p-img/x`.
  - `parseBriefs` keeps unread/highlighted flags and numeric `lastMessageDate`.
  - `parseDeal` (CDEK fixture): buyer name, phone, city, `deliveryMethod` "TK «СДЭК»", pickup address joined with ", ", one item with price/qty/url absolute; (pickup fixture): «способ получения», e-mail from `<div class="contact email">`.
  - `normalizeOrderUrl`: `"10000001"`, `"/deal/10000001"`, `"see https://baza.drom.ru/deal/10000001?x"` → `https://baza.drom.ru/deal/10000001`.
- [ ] **Step 2:** Implement, keeping each Python regex (as top-level `const` regexes for Biome). `parseView` deal system lines become `{ messageId: \`deal:${hash}\`, direction: "in", isDealSystem: true, images: [] }`; listing = header link that is not a `/deal/` link (`url`, `title`, `price` from `parsePriceFromTitle`); when only an order exists, `listing = { title: <sub-title tail>, url: null, price: <order price> }`.
- [ ] **Step 3:** `npx vitest run __tests__/parse.test.ts` → PASS; tsc; ultracite.
- [ ] **Step 4: Commit** `feat(drom): parse DROM dialogs, briefs, deals and chat photos`

---

### Task 5: DROM APIs and `pollDrom`

**Files:**
- Create: `integrations/drom/src/apis/{inbox.ts,dialog.ts,media.ts,deal.ts}`, `src/handlers/event.ts`, `src/handlers/poll.ts`, `src/lib/ids.ts`
- Test: `__tests__/apis.test.ts`, `__tests__/poll.test.ts`

**Interfaces — Produces:**

```ts
// apis/inbox.ts
export const getInboxConfig: (auth: DromAuthValue) => Promise<{ hasDialogs: boolean; unreadDialogs: number }>
export const listBriefs: (auth: DromAuthValue) => Promise<DromBrief[]>
// apis/dialog.ts
export const viewDialog: (auth: DromAuthValue, dialogId: string) => Promise<DromView>
export const sendDromMessage: (auth: DromAuthValue, input: { dialogId: string; text: string; imageIds?: string[] }) => Promise<{ latestMessageId: string | null }>
// apis/media.ts
export const uploadDromImage: (auth: DromAuthValue, file: { name: string; mime: string; bytes: Uint8Array }) => Promise<{ imageId: string }>
export const downloadDromImage: (auth: DromAuthValue, url: string) => Promise<{ bytes: Uint8Array; mime: string; filename: string }>
// apis/deal.ts
export const fetchDeal: (auth: DromAuthValue, orderUrl: string) => Promise<DromDeal>
// lib/ids.ts
export const makeDromMessageId: (dialogId: string, messageId: string) => string   // `drom:${dialogId}:${messageId}`
export const makeDromOutgoingId: (dialogId: string, latestMessageId: string | null) => string // `drom-out:${dialogId}:${latestMessageId ?? randomHex(8)}`
// handlers/event.ts
export const dromInboundEventSchema: z.ZodType<DromInboundEvent>
export type DromInboundEvent = {
  kind: "message"; sourceId: string; dialogId: string; messageId: string; interlocutor: string
  text: string; images: DromImage[]; isDealSystem: boolean
  listing: DromListing | null; deal: DromDeal | null
}
export const parseDromEvent: (payload: unknown) => DromInboundEvent | null
// handlers/poll.ts
export type DromDialogCursor = { lastInboundId: string; lastMessageDate: number; seenDealIds: string[]; fetchedDealUrls: string[]; updatedAt: number }
export type DromCursor = { dialogs: Record<string, DromDialogCursor> }
export const pollDrom: (input: { auth: DromAuthValue; cursor: PollCursor | null; now?: Date }) => Promise<PollResult>
```

API details (from `drom_messaging.py`):
- `getInboxConfig`: `GET /personal/messaging/inbox-config` → `{ hasDialogs: Boolean(r.hasDialogs), unreadDialogs: Number(r.eventCounts?.unreadDialogs ?? 0) }`.
- `listBriefs`: `GET /personal/messaging/inbox-list` → `parseBriefs`.
- `viewDialog`: `GET /personal/messaging/view?dialogId=<id>&json=true&flat-layout=false&ajax=1`, referer `${BASE}/personal/messaging-modal/dialog-<id>` → `parseView`.
- `sendDromMessage`: rejects empty text with no images (`DromException("emptyMessage")`); `viewDialog` first for `latestMessageId`; `POST /personal/messaging/view?dialogId=<id>&flat-layout=false&latestMessageId=<latest>&ajax=1`, form `{ message: text, "images[<id>]": "1" … }`, `utfFields: "message"`; returns the latest id from the response's `dialog` HTML when present (`parseView(response).latestMessageId`), else the pre-send one.
- `uploadDromImage`: `POST /upload-image-jquery` multipart `up[]`; response `items[0].id` or `id`; `error` → `DromAPIException`; no id → `DromAPIException("no_image_id")`.
- `downloadDromImage`: `isDromImageUrl` guard (`DromException("urlNotAllowed")`), `getBinary`, filename = last path segment or `drom_photo`.
- `fetchDeal`: `normalizeOrderUrl`; HTML shorter than 200 chars → `DromAPIException("empty_order_html")`; `parseDeal`.

`pollDrom` (port of `poll_unread`, lines 1142–1292):
1. `cursor = parse(cursor) ?? { dialogs: {} }`; `listBriefs`.
2. Targets: `isUnread || highlighted || (known dialog && lastMessageDate > cursor.lastMessageDate)`; sort unread first, then newest `lastMessageDate`; take `auth.maxDialogsPerPoll`.
3. Per target: `viewDialog`; interlocutor = login over numeric id (`resolve_drom_poll_interlocutor`); new messages = unseen deal system lines + chat inbound with id > `lastInboundId` (numeric compare), or — first sight — only the latest chat inbound when the brief is unread/highlighted.
4. Deal: if `view.orderUrl` is not in `fetchedDealUrls`, `fetchDeal` once and attach to every new event of this dialog in this poll; remember the URL. A deal fetch failure (non-session) is logged with `{ err }` and the events go out without `deal`.
5. Event per new message: `sourceId = makeDromMessageId(dialogId, messageId)`, `text = msg.text || (images.length ? "📷 Фото" : "")` (skip when both empty), `listing = view.listing`.
6. Cursor per dialog: `lastInboundId` = max numeric inbound id (or previous), `lastMessageDate` = brief's or previous, `seenDealIds` ∪ new deal ids, `updatedAt = now`. Dialogs whose `updatedAt` is older than 60 days are pruned.
7. `DromSessionExpiredException` propagates (runPoll → `needs_reauth`); any other error of one dialog is logged and that dialog is retried next poll (cursor unchanged for it); a session error stops the poll.

- [ ] **Step 1: API tests** (msw) for each function above, including send form body and latest-id flow, upload error/no-id, foreign image URL refused.
- [ ] **Step 2: Poll tests** (msw for inbox-list / view / deal):
  1. first sight unread dialog with 3 inbound → one event (latest), cursor `lastInboundId` = max id;
  2. known dialog, new inbound ids 11, 12 after watermark 10 → two events in order;
  3. read dialog whose `lastMessageDate` did not move → not viewed;
  4. deal system line emitted once across two polls (`seenDealIds`);
  5. order URL fetched once; second poll does not call `/deal/…`; contact data present on the event;
  6. deal fetch 500 → events without `deal`, poll succeeds;
  7. `maxDialogsPerPoll: 1` with two unread → one dialog viewed, the other stays unwatermarked;
  8. HTML instead of JSON on inbox-list → rejects with `DromSessionExpiredException`;
  9. one dialog view 500 → other dialogs processed, failed dialog's cursor unchanged;
  10. photo-only message → text "📷 Фото", images kept;
  11. dialogs untouched for 61 days pruned.
- [ ] **Step 3:** Implement; tests → PASS; tsc; ultracite.
- [ ] **Step 4: Commit** `feat(drom): poll DROM dialogs with deal and listing enrichment`

---

### Task 6: Message handlers, integration definition, provider registration

**Files:**
- Create: `integrations/drom/src/handlers/message/{incoming-message.ts,outgoing-message.ts,index.ts}`, `src/integration.ts`, `src/index.ts`
- Test: `__tests__/messages.test.ts`, `__tests__/integration.test.ts`
- Modify: `packages/business/src/connection/store-bindings-channels.ts` (`drom: makeChannelBinding({ table: integrationDromModel, tableName: "IntegrationDrom", identityColumn: "sellerLogin", onDisconnect: "delete_row", duplicateConstraint: "IntegrationDrom_sellerLogin_key", sealAuth: true })`), `packages/connections/src/registry.ts` (`drom: fromIntegration(integrationDrom, "drom")`), `packages/channel-registry/src/registry.ts` (integrations map, `case "drom"` → `IntegrationDrom` / `sellerLogin`, `integrationTableByChannel.drom`), `package.json` of connections, channel-registry, builder, worker (`"@chatbotx.io/integration-drom": "workspace:*"` before `integration-zzap`), `pnpm-lock.yaml`

Behaviour:
- `receiveMessage`: `parseDromEvent` (malformed → `DromException("DROM poll event is malformed")`); every `event.images` entry → `downloadDromImage` + `ctx.uploader.putObject` (same as zzap `storeMedia`; a failed download appends `📎 <url>` to the text instead); `message = { sourceId, messageType: incoming, contentType: text, text, attachments, contentAttributes: { dromContext: { dialogId, listing, deal } } }`; `contact = { sourceId: dialogId, firstName: deal?.buyerName || interlocutor || dialogId, sourceUsername: interlocutor when not numeric, phoneNumber: deal?.phone, email: deal?.email }` (omit empty keys).
- `sendFlowStep` / `sendMessage`: `flowStepToTextOutgoing` / `messageToTextOutgoing`; media → `fetch(url)` (the platform's own stored URL) → `uploadDromImage` (≤ 8; extra media appended as links); texts = `renderTextAndButtons(outgoing, DROM_TEXT_LIMIT)`; first `sendDromMessage` carries the image ids (with the first text chunk or alone), the rest one call per chunk; returns `{ messageIds: makeDromOutgoingId(...) per call, sentCount }`; errors → `mapToChannelError` after `logger.error({ err }, …)`.
- `integration.ts`: `name: "drom"`, `kind: "channel"`, `strategy: "token"`, `multiAccount: false`, `startsPaused: true`; `configFields`: `secretText` (secret, required — the cookies), `sellerLogin` (string, required), `pollIntervalSeconds`, `maxDialogsPerPoll`, `requestMinIntervalSeconds` (number, optional); `toDromAuth(input)` = `toCookieHeader(secretText)`, trimmed login, defaults, `pollIntervalSeconds ≥ DROM_MIN_POLL_INTERVAL_SECONDS`, `maxDialogsPerPoll ≥ 1`, `requestMinIntervalSeconds ≥ 0`; `describe` → `{ sourceId: sellerLogin, displayName: \`DROM ${sellerLogin}\` }`; `fromCredentials` = `toDromAuth` + `getInboxConfig` probe; `verify` = `probeVerify(() => getInboxConfig(auth), { label: "DROM cookies", isRevoked: isRevokedTokenError })`; `isRevokedTokenError`; `poll = { intervalSeconds: a => a.pollIntervalSeconds, run: ({ auth, cursor }) => pollDrom({ auth, cursor }) }`; `actions: {}`; `handleRequest` throws `DromAPIException`; `disconnect` no-op.

- [ ] **Step 1: Tests**: receive (deal contact mapping, image stored with cookies, failed image → link, dromContext present, malformed rejects); send (text + quick replies numbered; image upload then send with `images[<id>]`; > 8 images → links; session expired → `ChannelError` AUTH_FAILED); integration (starts paused, defaults/clamps, `fromCredentials` probes inbox-config and rejects HTML, `describe`).
- [ ] **Step 2:** Implement; registration edits; `CI=true pnpm install --no-frozen-lockfile`.
- [ ] **Step 3:** tsc: drom, connections, channel-registry, business; tests: drom, connections, channel-registry, `business src/connection` → PASS; ultracite on touched paths.
- [ ] **Step 4: Commit** `feat(drom): add DROM message handlers and register the polling channel provider`

---

### Task 7: Business service, builder UI, translations

Mirror Plan 2 Task 8 (`git show b5674aa36 --stat`, `b7ac477d5`): `zzap`→`drom`, `Zzap`→`Drom`, `codeObject`→`sellerLogin`.

**Files:**
- Create: `packages/business/src/integration-drom/{service.ts,index.ts,__tests__/service.test.ts}` (`DromChannelRow` = `ZzapChannelRow` with `IntegrationDromModel`); Modify `packages/business/src/index.ts`
- Create: `apps/builder/src/features/integration-drom/{schema/request.ts,lib/drom-connection.ts,actions/connect.action.ts,actions/set-enabled.action.ts,actions/disconnect.action.ts,queries/index.ts,components/drom-connect.tsx,components/drom-enabled-switch.tsx,components/drom-disconnect.tsx,drom-manage.tsx}`
- Create: `apps/builder/src/app/space/[workspaceId]/(settings)/settings/channels/drom/page.tsx`
- Modify: `apps/builder/src/app/(no-sidebar)/channels/create/page.tsx` (`DromConnect` branch; `WORKSPACE_REQUIRED_CHANNELS = ["max", "zzap", "drom"]`)
- Modify: `apps/builder/__tests__/api-parity-manifest.json` (3 × `covered:connections` after the `integration-custom-…`/before `integration-drip` — at the sorted position for `integration-drom/…`)
- Create: `apps/builder/__tests__/integration-drom-actions.test.ts`
- Modify: 21 × `apps/builder/messages/*.json`

Differences from ZZAP:
- `connectDromRequest = z.object({ secretText: z.string().trim().min(1), sellerLogin: z.string().trim().min(1) })`; `connectDrom` passes `config: input.config` (no extra fields).
- `drom-connect.tsx`: props `defaultSellerLogin?: string`, `mode?: "connect" | "updateCookies"`; fields: seller login (`InputField`, `fields.drom.sellerLogin`, read-only when `mode === "updateCookies"`), cookies (`TextareaField`, `fields.drom.cookies`, hint `fields.drom.cookiesHint`, `rows={5}`); instructions `fields.drom.connectInstructions.step1..3`; title `actions.addFeature` or `fields.drom.updateCookies`.
- `drom-manage.tsx`: ZZAP table + an "Update cookies" button (`fields.drom.updateCookies`) shown when the connection is `paused` or `needs_reauth`, rendering `<DromConnect mode="updateCookies" defaultSellerLogin={channel.sellerLogin}>`; the `needs_reauth` status text `fields.drom.status.needs_reauth` = "Cookies expired".

i18n `fields.drom`: `label` (exists), `sellerLogin: "Seller login"`, `cookies: "Cookies"`, `cookiesHint: "Paste the cookies exported with Cookie-Editor (JSON) or a Cookie header."`, `connectInstructions.step1: "Sign in to baza.drom.ru as the seller in your browser."`, `step2: "Export the cookies of drom.ru with the Cookie-Editor extension (Export → JSON)."`, `step3: "Paste them below together with your seller login. The channel is created switched off."`, `updateCookies: "Update cookies"`, `enabled: "Receiving and sending"`, `enabledHint: "While switched off ChatbotX does not poll DROM, so another system can serve this seller."`, `status.{connected: "On", paused: "Off", needs_reauth: "Cookies expired", degraded: "Problem", disconnected: "Disconnected"}`, `switchedOn: "DROM channel is on"`, `switchedOff: "DROM channel is off"`, `lastPolledAt: "Last poll"`, `lastError: "Last error"`.

- [ ] **Step 1:** Service + test (no connection → nulls; connection + poll state mapped).
- [ ] **Step 2:** Builder files, page, create page, manifest, actions test (connect passes `provider: "drom"` and the config; update-cookies reuses `connectDrom`).
- [ ] **Step 3:** i18n (python merge like Plan 2; only insertions); `pnpm i18n:check`.
- [ ] **Step 4:** builder tests (`integration-drom-actions`, `api-parity-manifest`, `i18n-*`), builder + business tsc → PASS; ultracite.
- [ ] **Step 5: Commit** `feat(drom): add DROM channel settings with cookie connect, cookie update and poll status`

---

### Task 8: Verification and docs

- [ ] **Step 1:** `apps/cli/README.md` `### connections`: DROM `connections create --provider drom --config '{"secretText":"<cookies>","sellerLogin":"<login>"}'` and a line "run the same create again to replace expired cookies (channel must be off or need reauth)".
- [ ] **Step 2:** `npx ultracite check apps packages integrations`; drift check; tsc builder, worker, business, connections, channel-registry, sdk, zzap, drom; full tests of worker, business, connections, channel-registry, sdk, zzap, drom, flow-config, utils, cli, builder.
- [ ] **Step 3:** `invariant-guard` on `9955da0e4..HEAD`; fix findings.
- [ ] **Step 4:** Show the `integration_drom` migration and ask for approval before `db:migrate`; after approval run it and `test:db`.
- [ ] **Step 5:** Visual check with Playwright (`/tmp/pw/shot.mjs`): `settings/channels/drom` empty state and the create form. No real cookies.
- [ ] **Step 6:** `.superpowers/sdd/progress.md`: Plan 3 commits, results, "PLAN 3 COMPLETE — next: Plan 4 (Geka import)".
