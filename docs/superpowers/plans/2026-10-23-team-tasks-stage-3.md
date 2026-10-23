# Team Tasks — Stage 3 (feed: mentions, attachments, edit/delete, unread, realtime) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** лента задачи становится полноценной перепиской сотрудников: `@упоминания` сотрудников и команд, файлы (до 10 по 25 МБ), правка и удаление своих комментариев, счётчик непрочитанных в списке задач, обновление без перезагрузки страницы. Всё, что делает интерфейс, кроме личной отметки «прочитано», доступно через публичный API.

**Architecture:** чистый разбор упоминаний в `@chatbotx.io/utils` (общий для сервера и браузера) → `internalThreadService` (упоминания, вложения, правка, удаление, прочитано, непрочитанные) и `taskService` (обёртки с проверкой доступа к задаче) → загрузка файла через builder (oRPC `z.file()` → `uploader.putObject` в закрытый префикс `private/space/<ws>/tasks/<taskId>/…`) и выдача через подписанную ссылку `/media/task-attachment/<token>` (как существующий `/media/attachment`) → события realtime `taskChanged` / `taskCommentsChanged` (только id, данные клиент перечитывает со своими правами) публикует слой builder → интерфейс: редактор с `@` (TipTap, по образцу подстановки переменных), файлы, правка и удаление, значок непрочитанных, авто-«прочитано».

**Tech Stack:** Drizzle, oRPC (multipart `z.file()`), `@chatbotx.io/filesystem`, `@chatbotx.io/encryption` (media token), partysocket realtime, TipTap, TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-team-tasks-design.md` (3.2, 4.2, 5, 6; этап 3 из раздела 10). Этапы 1–2: `docs/superpowers/plans/2026-10-23-team-tasks-stage-{1,2}.md`.

---

## Global Constraints

- Те же, что на этапах 1–2 (`.superpowers/sdd/tasks-constraints.md`): локально только `npx ultracite check|fix <files>` и точечные `vitest run <files>`; `check-types` и полные тесты — в GitHub CI; без печати секретов; `git add <конкретные пути>`; не трогать `apps/builder/AGENTS.md`; `{ err }` в логах; без динамических `import()` вне builder.
- **Миграций нет** (`InternalThreadMember.lastReadAt`, `InternalMessage.mentions/attachments/editedAt/deletedAt` уже есть). Если исполнитель решит, что нужна, — остановиться и спросить.
- **Не импортировать `platform/settings` и `platform/realtime-broadcast` в `packages/business/src/task/**` и `internal-thread/**`** — это даёт круг `task → settings → workspace → workspace-member → task` (нашли на этапе 2). Ссылки (`url`) и публикация realtime — в слое builder.
- Цепочка `handler → service → repository → DB`; публичная и приватная процедуры одного действия вызывают один метод сервиса.
- i18n во всех 22 `apps/builder/messages/*.json` (en — английский, ru — русский, остальные — английская копия скриптом); совпадения ru==en — в `apps/builder/__tests__/fixtures/ru-same-as-english.json`.
- TypeScript проверяется только в CI. Известные ловушки: `Select.onValueChange` из base-ui — `(value: unknown, eventDetails)`; generic-обёртки над zod `.extend` теряют типы; `Select` без `items` показывает сырое значение; `perPage` ≤ `PUBLIC_LIST_MAX_PER_PAGE` (50).
- Новые тестовые файлы — в `.github/workflows/gkamion-checks.yml`.

## Deviations from the spec (decided while planning)

1. **Файлы идут через builder, а не напрямую в S3.** В проде `S3_ENDPOINT` = `127.0.0.1:9010`, подписанная ссылка S3 из браузера не откроется. Загрузка — oRPC-процедура с файлом (multipart), выдача — наш маршрут `/media/task-attachment/<token>` с подписанным токеном на 1 час (механизм `signMediaToken`, новый вид `taskAttachment`). Файлы лежат под `private/space/<ws>/tasks/<taskId>/<id>` без `public-read`; в nginx закрываем `/storage/private/`.
2. **Загрузка — отдельный шаг:** `tasks.attachments.upload` (файл → `{ key, name, size, mimeType }`), затем `tasks.comments.create` с `attachments: [{ key, name }]`. Сервер сам проверяет ключ (префикс этой задачи) и берёт размер и тип из хранилища (`headObject`), клиенту не доверяем. Неиспользованные загрузки не чистим (этап позже).
3. **Упоминание команды** хранится и показывается, но в наблюдатели добавляются только упомянутые сотрудники; уведомления команде — этап 4.
4. **Права на комментарии:** править — автор-сотрудник в течение 24 часов, или API-токен свои комментарии (`authorUserId = null`, тот же `authorLabel`); удалять — автор в течение 24 часов, владелец пространства и API-токены (полномочия пространства) — всегда. Системные события не правятся и не удаляются.
5. **Непрочитанные** — комментарии (не системные, не удалённые, не свои), созданные после `lastReadAt` сотрудника в ленте; если сотрудник не участник ленты — 0. Поле `unreadCount` только в приватном API (личное состояние сессии), `tasks.markRead` — только приватный (исключение инварианта 23, как центр уведомлений в спеке).
6. **Realtime — события без данных:** `taskChanged { taskId }` и `taskCommentsChanged { taskId }` всему пространству; браузер перечитывает через свой приватный API (права и скрытие контактов сохраняются). Публикует builder (публичные и приватные обработчики через один помощник); перевод задач на владельца при удалении сотрудника событие не шлёт.
7. **Редактор упоминаний — TipTap** по образцу `components/tiptap/extensions/variable-injection` (символ `@`, список сотрудников и команд), в текст сохраняется `@[Имя](user:<id>)` / `@[Команда](team:<id>)`.

## File map

**Create**
- `packages/utils/src/internal-mentions.ts` (+ экспорт) — `INTERNAL_MENTION_PATTERN`, `parseInternalMentions(text)`, `splitInternalMentionText(text)` (сегменты для отрисовки).
- `packages/business/src/internal-thread/attachments.ts` — ключи, проверка, загрузка.
- `apps/builder/src/features/tasks/lib/{task-realtime.ts,attachment-url.ts}`.
- `apps/builder/src/app/media/task-attachment/[token]/route.ts`.
- `apps/builder/src/features/tasks/components/{mention-editor.tsx,comment-composer.tsx,comment-item.tsx,comment-attachments.tsx,tasks-realtime-sync.tsx,task-unread-badge.tsx}` (+ расширение TipTap в `features/tasks/components/mention/` или рядом с `variable-injection`).
- Тесты: `packages/utils/__tests__/internal-mentions.test.ts`, `packages/business/__tests__/task/internal-thread-stage3.test.ts`, `packages/business/__tests__/task/task-attachments.test.ts`, `apps/builder/__tests__/tasks-comments-api.test.ts`, `apps/builder/__tests__/task-attachment-route.test.ts`.

**Modify**
- `packages/database/src/repositories/internal-thread/repository.ts` (+ методы), `packages/database/src/repositories/task/repository.ts` (если нужно для `threadId`).
- `packages/business/src/internal-thread/{service.ts,view.ts,message-rows.ts}`, `packages/business/src/task/{service.ts,index.ts}`.
- `packages/encryption/src/media-token.ts` (вид `taskAttachment`).
- `packages/partysocket-config/src/schemas.ts` (+ тест реестра событий).
- `apps/builder/src/features/tasks/{schema/public.ts,api/public.ts,api/private.ts}`, `apps/builder/__tests__/{tasks-public-api,tasks-private-api}.test.ts`, снимок `public-spec-operations`.
- `apps/builder/src/features/tasks/components/{task-feed,task-details,tasks-table,contact-tasks-section}.tsx`, раскладка пространства (подключить `TasksRealtimeSync`).
- `apps/builder/messages/*.json`, `apps/builder/__tests__/fixtures/ru-same-as-english.json`.
- `deploy/gkamion/nginx/chatbotx.gkamion.ru.conf` (`/storage/private/` → 404).
- `docs/tasks.md`, `apps/cli/README.md`, `apps/mcp-server/README.md`, `.github/workflows/gkamion-checks.yml`.

## Models (cost/quality)

| Работа | Модель |
|---|---|
| Задачи 1–2 (бэкенд, API) | composer-2.5-fast |
| Задача 3 (интерфейс) | gpt-5.6-terra-medium |
| Задача 4 (документация, nginx, CI) | composer-2.5-fast |
| Ревью задач | gpt-5.6-terra-medium |
| invariant-guard | claude-haiku-5-5-thinking-high |
| Финальное ревью (с упором на ошибки типов и безопасность файлов) | claude-opus-5-5-medium |

---

### Task 1: Mentions, attachments, edit/delete, read state in services

**Files:** см. File map (utils, database repository, business, encryption).

**Interfaces (produces):**
- `@chatbotx.io/utils`: `INTERNAL_MENTION_PATTERN = /@\[([^\]\n]{1,100})\]\((user|team):(\d{1,20})\)/g`; `parseInternalMentions(text: string): { userIds: string[]; teamIds: string[] }` (уникальные, в порядке появления); `splitInternalMentionText(text): Array<{ type: "text"; text: string } | { type: "mention"; kind: "user" | "team"; id: string; label: string }>`.
- `internalThreadRepository`: `findMessage({ workspaceId, threadId, id, tx })`, `updateMessage({ workspaceId, id, set, tx })`, `markRead({ threadId, userId, at, tx })` (update `lastReadAt` у участника; вернуть, был ли участник), `countUnreadByThreads({ workspaceId, userId, threadIds, tx }): Promise<Map<string, number>>` — один запрос: `InternalMessage` join `InternalThreadMember` (threadId, userId), `kind = 'comment'`, `deletedAt is null`, `authorUserId is distinct from userId`, `createdAt > coalesce(lastReadAt, '-infinity')`, `group by threadId`.
- `packages/business/src/internal-thread/attachments.ts`:
  - `TASK_ATTACHMENT_LIMITS = { maxFiles: 10, maxBytes: 25 * 1024 * 1024 }`.
  - `taskAttachmentPrefix(workspaceId, taskId)` → `private/space/${workspaceId}/tasks/${taskId}/`.
  - `uploadTaskAttachment({ workspaceId, taskId, file: File })` → `uploader.putObject(prefix + createId(), Buffer, { ContentType, ContentDisposition })` (без ACL) → `{ key, name: file.name, size, mimeType }`; больше `maxBytes` → `validationException("file", …)`.
  - `resolveTaskAttachments({ workspaceId, taskId, items: { key; name }[] })` → для каждого: ключ начинается с префикса, иначе `validationException`; `uploader.headObject(key)` → размер/тип из хранилища (нет объекта → `validationException`); `size > maxBytes` → ошибка; больше `maxFiles` → ошибка. Возвращает `InternalMessageAttachment[]` (`name` обрезать до 255, без `/` и `\`).
- `internalThreadService`:
  - `postComment({ workspaceId, threadId, text, attachments, actor, tx })` — `mentions` из `parseInternalMentions`, отфильтрованные по пространству (`taskRepository.listMemberUserIds` / `listTeamIds` или аналоги в thread-репозитории — без новых кругов импорта). Пустой текст разрешён, только если есть вложения (иначе `validationException("text", …)`).
  - `editComment({ workspaceId, threadId, id, text, actor })`, `deleteComment({ workspaceId, threadId, id, actor, isOwner })` — права из Deviation 4 (функция `canEditComment` / `canDeleteComment` в отдельном чистом файле с тестами), `editedAt = now`, мягкое удаление `deletedAt = now`; системное/удалённое → `validationException`; чужое → `taskForbiddenException` (или общий forbidden того же вида).
  - `markRead({ threadId, userId })`, `countUnread({ workspaceId, userId, threadIds })`.
- `InternalMessageView` + `mentions`, `attachments: { index: number; name: string; size: number; mimeType: string }[]` (без `key`; у удалённых — `[]`), `messageWorkspaceId` не нужен.
- `taskService`: `addComment({ …, text, attachments?: { key; name }[] })` (вложения через `resolveTaskAttachments`; упомянутые сотрудники → наблюдатели через существующий `addWatcherRows`), `updateComment({ workspaceId, id, commentId, text, actor })` (новые упомянутые → наблюдатели), `deleteComment({ workspaceId, id, commentId, actor })`, `uploadAttachment({ workspaceId, id, file })` (сначала `findOrFail`), `markRead({ workspaceId, id, userId })`, `findAttachment({ workspaceId, messageId, index })` → `{ key, name, mimeType, size } | null` (не удалённый комментарий этого пространства). `get`/`list` принимают `viewerUserId?: string` и тогда кладут в вид `unreadCount` (одним запросом на страницу).
- `packages/encryption/src/media-token.ts`: `kind: z.enum(["attachment", "avatar", "taskAttachment"])`; для `taskAttachment` `refId = "<messageId>:<index>"`.

- [ ] **Step 1: Failing tests:** разбор упоминаний (пусто, несколько, повтор, мусор вроде `@[a](user:abc)`, переносы строк, сегменты); фильтр чужих id; упомянутый сотрудник стал наблюдателем; права правки/удаления (автор < 24 ч, автор > 24 ч, владелец, API свой/чужой, системное, удалённое); вложения (чужой префикс, нет объекта, больше 25 МБ, больше 10 файлов, размер берётся из `headObject`); непрочитанные (свои не считаются, удалённые и системные не считаются, не участник → 0); `markRead` для не участника ничего не делает; вид удалённого — без текста и вложений.
- [ ] **Step 2: Run, see fail; implement; run, see pass** (вместе со старыми `__tests__/task`).
- [ ] **Step 3:** ultracite. **Commit** `feat(tasks): mentions, attachments, comment edit/delete and unread in services`.

---

### Task 2: API, media route, realtime events

**Interfaces (produces):**
- Схемы (`schema/public.ts`): `taskCommentPublicResource` + `mentions { userIds, teamIds }`, `attachments [{ index, name, size, mimeType, url }]`; `createTaskCommentPublicRequest`: `text` необязателен (≤ лимита), `attachments?: [{ key, name }]` (≤ 10), refine «текст или файл»; описание формата упоминаний `@[Name](user:<userId>)` / `@[Team](team:<teamId>)` (id из `workspaceMembers.list` / `inboxTeams.list`); `updateTaskCommentPublicRequest { id, commentId, text }`; `taskCommentIdPathParam { id, commentId }`; `uploadTaskAttachmentRequest { id, file: z.file().max(25 MB) }` (проверить, что oRPC 1.15 и генератор спецификации принимают `z.file()`; если нет — `z.instanceof(File)` с `.meta`/описанием; если multipart не поддерживается вовсе — остановиться и спросить).
- Публичные процедуры (`api/public.ts`, все с происхождением id в описании): `tasks.comments.update` (PATCH `/v1/tasks/{id}/comments/{commentId}`), `tasks.comments.delete` (DELETE, 204), `tasks.attachments.upload` (POST `/v1/tasks/{id}/attachments`, multipart, 201 → `{ key, name, size, mimeType }`, описание: «затем передайте `key`/`name` в `tasks.comments.create`»). `tasks.comments.create` принимает вложения.
- Приватные (`api/private.ts`): то же + `markRead` (POST `/workspaces/{workspaceId}/tasks/{id}/read`, 204, `userId = context.user.id`); `get`/`list` передают `viewerUserId: context.user.id`, в ответе `unreadCount: number` (приватная схема = публичная + `unreadCount`, через `.extend` без generic-обёрток).
- `lib/attachment-url.ts`: `withCommentAttachmentUrls(workspaceId, comments)` — для каждого вложения `url = ${appUrl}/media/task-attachment/${await signMediaToken({ workspaceId, kind: "taskAttachment", refId: `${commentId}:${index}` })}` (`appUrl` через `resolveTenantSettings` один раз). Применить во всех ответах с комментариями (list, create, update) — публичных и приватных.
- Маршрут `app/media/task-attachment/[token]/route.ts` по образцу `app/media/attachment/[token]` + `media-proxy.ts` (проверка токена и вида, лимит частоты, `loadServableWorkspace`): `taskService.findAttachment` → `uploader.getObject(key)` → ответ с `Content-Type`, `Content-Disposition: attachment; filename*=UTF-8''<encoded>`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=300`; нет вложения → 404. Проверить, что `/media` уже в `publicRoutes` (`proxy.ts`), иначе добавить. Ответ потоком, если `uploader` умеет (иначе `getObject` Buffer — до 25 МБ допустимо).
- Realtime: в `packages/partysocket-config/src/schemas.ts` события `taskChanged`, `taskCommentsChanged` с данными `{ taskId: string }`, `durability: "ephemeral"`, топик `chat`; обновить тест реестра. `lib/task-realtime.ts`: `publishTaskChanged(workspaceId, taskId)`, `publishTaskCommentsChanged(workspaceId, taskId)` через `publishToWorkspaceParty` из `@chatbotx.io/business` (огонь-и-забыть, ошибки не ломают ответ). Вызывать после успешных create/update/complete/take/delete/addWatcher/removeWatcher (`taskChanged`) и comments create/update/delete (`taskCommentsChanged` + `taskChanged`, т.к. меняются непрочитанные) — в публичных и приватных обработчиках.
- Тесты: обработчики вызывают сервис с нужными аргументами и публикуют события; маршрут файла (плохой токен → 404, чужой вид → 404, нет вложения → 404, успех — заголовки); снимок спецификации (`-u`, добавились только новые операции); `public-spec-mcp` (новые операции не в наборе по умолчанию).

- [ ] Implement, tests pass, ultracite. **Commit** `feat(tasks): comment edit/delete, attachments upload and realtime events API`.

---

### Task 3: Feed UI — mention editor, attachments, edit/delete, unread, realtime

- [ ] **Редактор с упоминаниями** (`mention-editor.tsx`): TipTap по образцу `components/tiptap/extensions/variable-injection/{mention.ts,suggestion.tsx}` и `plain-text-tiptap-editor.tsx`; символ `@`; список — сотрудники (`useWorkspaceMembers`) и команды (`useInboxTeams`), фильтр по имени, до 8 пунктов, клавиатура (↑↓ Enter Esc); узел упоминания рисуется как «@Имя»; наружу отдаётся строка с токенами `@[Имя](user:<id>)`; Ctrl/⌘+Enter — отправить; очистка после отправки; плейсхолдер из i18n.
- [ ] **Поле ввода** (`comment-composer.tsx`): редактор + кнопка «Прикрепить» (скрепка, `aria-label`) → выбор до 10 файлов, каждый ≤ 25 МБ (иначе тост), загрузка по одному через `tasksAPI.attachments.upload` с индикатором, список выбранных с удалением, «Отправить» → `comments.create({ text, attachments })`; блокировать отправку, пока идут загрузки.
- [ ] **Комментарий** (`comment-item.tsx`): автор, время (`useFormatter`), «изменено»; текст через `splitInternalMentionText` (упоминание — выделенный `@Имя`; имя из справочника, иначе из метки токена); ссылки — только текстом (без HTML); вложения (`comment-attachments.tsx`): картинки (`image/*`) — превью-миниатюры по `url`, остальное — имя, размер, ссылка «Скачать»; удалённый — «Комментарий удалён». Меню «Изменить» / «Удалить» по правилам Deviation 4 (на клиенте: автор и < 24 ч, или владелец для удаления; сервер всё равно проверит); правка — тот же редактор с исходным текстом; удаление — подтверждение. После мутаций — `useInvalidateTasks`.
- [ ] **Лента** (`task-feed.tsx`): заменить поле ввода на `CommentComposer`, элементы — на `CommentItem`; системные события как сейчас.
- [ ] **Непрочитанные:** `task-unread-badge.tsx` (число в кружке, `aria-label` «N непрочитанных», 99+); показать в строке таблицы задач (рядом с названием) и в блоке задач контакта. Открытие карточки и приход новых комментариев при открытой карточке → `tasksAPI.markRead` (не чаще раза в 2 с), затем инвалидировать `tasksAPI.list`/`get`.
- [ ] **Realtime** (`tasks-realtime-sync.tsx`): `useWorkspaceRealtimeEvents({ taskChanged, taskCommentsChanged })` → инвалидировать `orpc.tasksAPI.key()` с объединением событий за 300 мс; подключить один раз в раскладке пространства рядом с другими realtime-компонентами (найти, где смонтирован `WorkspaceRealtimeProvider` и подписчики чата). Если карточка этой задачи открыта — лента обновится сама через инвалидацию.
- [ ] i18n (все 22 файла), i18n-тесты, ultracite. **Commit** `feat(tasks): mentions, attachments, comment editing and live updates in task feed`.

---

### Task 4: Docs, nginx, CI, Hermes

- [ ] `deploy/gkamion/nginx/chatbotx.gkamion.ru.conf`: перед `location /storage/` добавить `location ^~ /storage/private/ { return 404; }`. Применение на сервере (`nginx -t && systemctl reload nginx`) — контроллер, после выкатки.
- [ ] `docs/tasks.md`: упоминания (формат, наблюдатели), вложения (лимиты, двухшаговая загрузка, подписанные ссылки 1 ч, закрытый префикс), правка и удаление (правила), непрочитанные и `markRead` (личное, без публичного API — причина), realtime-события; «Не сделано»: уведомления (этап 4), очистка неиспользованных загрузок и файлов удалённых задач.
- [ ] Навык `cli-mcp-docs`: новые операции в `apps/cli/README.md`, `apps/mcp-server/README.md` (не в наборе по умолчанию, `tasks.attachments.upload` — multipart, через CLI/HTTP).
- [ ] `.github/workflows/gkamion-checks.yml`: новые тесты (utils, business, builder).
- [ ] **Commit** `docs(tasks): stage 3 feed`.
- [ ] Контроллер после выкатки: навык Hermes `/opt/hermes-data/skills/chatbotx/SKILL.md` (резервная копия) — `tasks.count`, `tasks.take`, упоминания `@[Имя](user:<id>)`, загрузка файла и комментарий с файлом; перезапуск профиля ассистента.

---

## After all tasks

1. invariant-guard (haiku), финальное ревью (opus), исправления.
2. Push → зелёный `gkamion-checks.yml` → образ `builder` → `bash deploy/gkamion/up.sh builder` (worker не меняется — проверить по диффу; если `packages/business` используется worker'ом в изменённых местах — собрать и его).
3. nginx: `/storage/private/` → 404, `nginx -t`, reload.
4. Проверка на проде: комментарий с упоминанием (сотрудник стал наблюдателем), файл (загрузка, скачивание по ссылке, прямой `/storage/private/…` → 404), правка и удаление, счётчик непрочитанных во второй вкладке другим сотрудником, обновление без перезагрузки.

## Self-review

- Спека 4.2: упоминания ✓ (команды — без уведомлений до этапа 4), правка/удаление 24 ч ✓, `markRead` ✓, вложения 10 × 25 МБ, подписанные ссылки ✓ (через наш маршрут вместо S3 — Deviation 1). Раздел 5: непрочитанные в строке ✓, `@` в поле ввода ✓, файлы ✓. Раздел 6: все действия, кроме личного «прочитано», в публичном API ✓.
- Без миграций; без новых кругов импорта в `packages/business`.
