# T07 — проверка памяти диалога и сборка запроса (памятка)

Памятка по коду T07 в packages/business/src/external-agent/: что он делает, что именно проверяет и чего не делает — не инструкция по включению.

## Статус: SOURCEONLY

Исходники A (ccfbb2d4e) и B (665ac5dff) приняты независимыми ревью SPEC и QUALITY; родитель на неизменном коде выполнил 91/91 native-сценариев A,
55/55 native-сценариев B и точечный Biome. Это НЕ полная проверка типов, НЕ Vitest (в тестовом файле статически 42 блока test(), запуск не
производился; 55 — только native-сценарии B), НЕ БД, НЕ CI.
Функция не развернута и не активирована: T02 отложен, а не пройден; T06 — dataStatus="machine_candidate", humanApproved=false, оценщик ещё не
принял (литерального поля machineApproved в T06 нет — оно не вводилось). Всё T07-C не разрешает прод: включение, настройки, SQL-схема,
активации и перезапуски не выполнялись. Условия выпуска (полные типы, Vitest, БД, CI, T08, T09, T10) открыты.

## Состав: A, B, C

A — memory-contract.ts (схемы Zod 4, типы, лимиты, коды ошибок) и memory-validation.ts (проверка кандидата и источников); B — memory-prompt.ts
(отбор источников и упаковка запроса); C — публичные экспорты в external-agent/index.ts и этот документ.
Модули чистые: только type-only импорты DTO, zod и node builtin (node:util, Buffer); runtime-БД, сети и вызовов инструментов нет, приватный
prepareMemorySourcesInternal не экспортируется. Корневой packages/business/src/index.ts уже экспортирует ./external-agent и не менялся.

## Публичный API

createDialogMemoryValidator(deps?: { limits?, nowMs? }): SemanticValidatorPort
parseMemoryPayload(candidate: unknown, options?): ok(payload) | reject(reason)
prepareMemorySources({ sourceEvidence, scope, deadlineAtMs, signal? }, options?): ok(sources) | reject(reason)
validateMemoryPayload({ candidatePayload, sourceEvidence, scope, deadlineAtMs, signal? }, options?)
  -> { kind: "accept"; payload: MemoryPayload } | { kind: "reject"; reason: ValidationFailCode }
checkPriorQuoteRetention({ priorPayload: unknown | null; candidatePayload }, options?)
  -> { kind: "ok" } | { kind: "reject"; reason: ValidationFailCode | "prior_retention_violation" }
buildSourceView({ mode: "rebuild" | "append", batch, evidence, priorPayload, scope, deadlineAtMs, signal? }, options?)
  -> { kind: "ok"; view; normalizedPriorPayload: MemoryPayload | null } | { kind: "reject"; reason }
buildSummarizeRequest(те же поля + budget: { maxEncodedChars: number }, options?)
  -> ok({ messages, totalEncodedChars, totalUtf8Bytes, normalizedPriorPayload }) | oversize | reject
options = { limits?: ValidationLimitsOverride; nowMs?: () => number }, плюс deadlineAtMs/signal в MemoryParseOptions. Фабрика возвращает готовый
порт и ничего не вызывает сама. input.config в SemanticValidatorPort.validate есть (config: DialogMemoryConfig), но createDialogMemoryValidator
намеренно его не читает и не пробрасывает; отсутствует только поле prior — retention к валидатору T05 не подключён и остаётся обязанностью
T09 (см. «Retention prior»).

## Роли и допустимость

deriveAttribution по senderType: "contact" -> contact, "user" -> staff, "bot" | "api" -> automation, "system" и любое неизвестное -> unknown
(enum contact/staff/automation/unknown). Нет assistant, verified и CRM-ролей: атрибуция — серверная производная метка, не подлинность
утверждения. Допустимо (eligible) только type === "message" И deletedAtMicros === null; comment/activity и tombstone дают ref_ineligible и не
попадают ни в view, ни в newBatchRefs. Слова hidden в attributes T07 не интерпретирует: смысл скрытия не доказан, политика hidden — gate T10.

## Payload version 1 (strict)

version: 1 (literal); facts обязателен, каждый факт — только attribution и quotes (1..4), quote = { ref: { id, createdAtMicros }, text }
(text 1..1000 UTF-16); narrative { text, nonAuthoritative: true } и openQuestions [{ text, nonAuthoritative: true }] — недоверенный пересказ.
Лишние ключи запрещены, тихого усечения нет; fact.text, упоминаний, orderId/contactId, ссылок на заказы и суммы в схеме не существует.
id — каноничная положительная десятичная строка int8 (сравнение BigInt через compareRefsAsc), createdAtMicros — UTC
YYYY-MM-DDTHH:mm:ss.ffffffZ с шестью знаками; оба копируются буквально, без Number, Date и нормализации.

## Что доказывает проверка и порядок ошибок

validateMemoryPayload — структурно-литеральная сверка: точная цитата (UTF-16 includes без нормализации), точный полный ref в evidence,
атрибуция цитаты равна серверной производной. Это НЕ проверка истины, НЕ смысловое выведение, НЕ подтверждение оплаты/заказа/текущего ERP и
НЕ доказательство доставки: ложное в мире сообщение проходит как структурированное.
Приоритет — первый код зафиксированной стадии: deadline/cancelled (до старта и после каждой стадии) -> oversize сырых байтов до JSON.parse
-> parse_failed -> not_plain_json (preflight после parse) -> schema_mismatch -> ref_not_found/ref_ambiguous/ref_ineligible -> scope_mismatch
-> role_forged -> quote_mismatch -> accept. Коды ошибок — постоянные PII-free строки: сырой кандидат и приватные payload не логируются;
невалидный кандидат или источники дают такой постоянный reject, сырые исключения с содержимым наружу не пробрасываются. Полного «ничего не
бросает» нет: неверная доверенная серверная конфигурация лимитов (limits override) по контракту кидает RangeError в фабрике — см. «Лимиты».

## Защита ввода и проекции

Кандидат проходит предварительную проверку всего дерева: на каждом узле сначала types.isProxy (ловит отозванный Proxy, 0 обращений к ловушкам), затем дескрипторы:
прототип только null/Object.prototype/Array.prototype, own enumerable data-descriptors — getters/setters не читаются и не исполняются, toJSON и
symbol-ключи запрещены, дыры массива запрещены, WeakSet против циклов, well-formed UTF-16 без U+0000, числа finite; bounded глубина/узлы/байты;
JSON.stringify только после безопасного клона. У источников инспектируются только контейнеры (массив evidence, контейнер сообщения, поле
attachments, контейнер вложения) и поля белого списка: 6 обязательных строк (id, createdAtMicros, workspaceId, conversationId, senderType, type)
плюс nullable text/deletedAtMicros и attachments; у вложения — id, fileType, mimeType, workspaceId, conversationId, messageId,
messageCreatedAtMicros и nullable name. На инспектируемых контейнерах types.isProxy до любого отражения и plain-прототип; инспектируемые поля
читаются только как own enumerable data-descriptors (геттеры не исполняются), массивы — плотные, без дыр, symbol-ключей и toJSON. Игнорируемые
contentAttributes, attributes, sourceId, originPath/thumbnailPath и прочие приватные пути не читаются и не вызываются: они МОГУТ существовать в
DTO (включая геттеры, функции, toJSON, symbol-ключи), но никогда не обходятся и не сериализуются — их содержимое не инспектируется и само по себе
не ошибка. Весь фактический text (включая URL и служебные слова) остаётся дословно данными.
Проекция вложения — ровно 4 ключа { id, fileType, mimeType, name: string | null }; элемент view — ровно 5 ключей { id, createdAtMicros,
attribution, text, attachments }, не 6. Scope и родительские поля вложения сверяются с доверенным scope, несовпадение -> scope_mismatch;
владение контактом — обязанность репозитория.

## Лимиты (VALIDATION_LIMITS)

Кандидат: 64 KiB UTF-8, глубина 32, узлов 10000, facts до 64, quotes 1..4, quote 1..1000 UTF-16, narrative до 2000, openQuestions до 16
текстом 1..500. Источники — отдельные капы, на которые кандидат-кап не действует: 20000 элементов, 16 MiB ПРОЕКТИРОВАННЫХ байт (не байты кучи
и не полный размер DTO), вложений до 1000 на сообщение; превышение -> source_too_many_items или source_oversize.
Overrides limits — только положительные безопасные целые не выше значения по умолчанию, иначе RangeError в фабрике (серверная конфигурация);
budget.maxEncodedChars — положительный безопасный целый, иной -> постоянный reject schema_mismatch. Тихое усечение запрещено.

## buildSourceView

mode rebuild требует priorPayload === null, mode append — ненулевой валидный payload; любое нарушение -> invalid_prior. Prior проходит полную
проверку против ФАКТИЧЕСКОГО полного evidence валидатором A; любое несоответствие -> явный invalid_prior, без удаления и без счётчика priorNote.
Каждый полный ref batch обязан найтись в evidence и совпасть по каноническим инспектируемым полям, включая сырой senderType: нет ->
ref_not_found, дубль или несовпадение (подделка) -> ref_ambiguous; правки только игнорируемых metadata конфликтом не считаются.
Отбор: ВСЕ допустимые сообщения batch + ТОЛЬКО старые, цитируемые prior-quotes; дедуп по полным ref, порядок ASC (createdAtMicros, id) через
compareRefsAsc, id не превращается в Number, нерелевантная старая история не включается. Авторитетный view строится из evidence, а не из
batch; в newBatchRefs идут только допустимые сообщения batch.

## buildSummarizeRequest, бюджет и долг T09

Ровно два сообщения: system = фиксированный MEMORY_SYSTEM_TEXT + "\n\n" + MEMORY_SCHEMA_TEXT (версия t07-prompt-v1; по контракту 1790 и 900
символов UTF-16) и user = только JSON с DATA из ровно четырёх ключей mode, newBatchRefs, sourceMessages, priorPayload. Вызывающий код не
переопределяет системный текст, схему или view: готовый view не принимается, сборка внутренняя; лишние аргументы не читаются.
normalizedPriorPayload возвращается отдельно — серверный retention-контекст, не автоматическое поле HTTP-запроса.
totalEncodedChars = JSON.stringify({ messages }).length (UTF-16, со всем overhead), totalUtf8Bytes = Buffer.byteLength той же строки в UTF-8.
Граница точная: равное бюджету помещается, на единицу больше -> oversize; содержимое не урезается и не отбрасывается.
budget.maxEncodedChars = budgets.maxBatchEncodedChars (по умолчанию 24000) — входной бюджет запроса, не maxOutputEncodedChars (20000) и не
выходные токены провайдера. { kind: "oversize" } — не третий вид SummarizerPort (порт знает только ok|unavailable): T09 обязан отобразить его
в unavailable.reason "oversize", а узкий patch T05 (сейчас отказ сворачивается в llm_unavailable) ещё не сделан.
Молчаливая потеря prior, нарезка пачки и переключение на rebuild запрещены. T09 же измеряет финальное тело HTTP-запроса к провайдеру, таймауты,
auth и лимиты размера; устойчивость к инъекции в промпт и превосходство модели не заявляются.

## Retention prior

checkPriorQuoteRetention делает точный subset-тест свидетельств: каждая prior-цитата (производная attribution + полный ref + литеральный
text) обязана присутствовать в новом payload; группировка и порядок менять можно. priorPayload null -> ok только после успешного строгого
parse кандидата. Это не полная смысловая полнота и не сверка цитат с БД.
Так как SemanticValidatorPort не имеет поля prior, retention НЕ встроен в валидатор T05: T09 обязан вызвать checkPriorQuoteRetention ДО
возврата ok нового кандидата.

## T08, T10 и ворота выпуска

T08 (оценщик: негативы, контрольная группа, human labels) не выполнен; минимальная длина цитаты остаётся 1 и произвольно не меняется. T10
закрывает политику hidden и окончательный вход/выход. T02/T06/T08/T09/T10 и CI — условия выпуска: до их закрытия функция остаётся выключенной,
а этот документ описывает исходники, а не разрешает активацию, настройки или SQL-схему.
