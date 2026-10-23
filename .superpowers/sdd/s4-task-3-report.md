# Stage 4 — Task 3 report: Notification private API and UI

## Commit

`feat(tasks): notification bell, list and settings` (not pushed).

## Summary

- Added the private `notificationsAPI` with workspace membership middleware and signed-in-user scoping for list, unread count, read mutations, and all seven preferences.
- Notification list responses include task URLs using one `resolveTenantSettings` lookup per request.
- Added a responsive sidebar bell with unread badge, popover list, mark-read navigation, mark-all-read, translated notification copy, actor resolution, excerpts, and relative timestamps.
- Added optimistic per-toggle notification settings with rollback and an error toast.
- Added debounced `notificationCreated` realtime cache invalidation and mounted it in the workspace realtime shell.
- Added English copy to all 20 non-Russian catalogs and Russian translations to `ru.json`.

## Tests

- `apps/builder/__tests__/notifications-private-api.test.ts` — 3 passed.
- `apps/builder/__tests__/i18n-messages.test.ts` — 105 passed.
- `apps/builder/__tests__/i18n-source-keys.test.ts` — 3 passed.
- `apps/builder/__tests__/i18n-hardcoded-scanner.test.ts` — 5 passed.
- `apps/builder/__tests__/i18n-ru-tooling.test.ts` — 6 passed.
- `apps/builder/__tests__/i18n-request-config.test.ts` — 1 passed.
- `apps/builder/__tests__/i18n-zh-cn-parity.test.ts` — 1 passed.
- `apps/builder/__tests__/i18n-accept-language.test.ts` — 8 passed.
- Targeted Ultracite check — clean.
- Invariant guard — no violations.

## Concerns / deviations

1. No public API was added because the notification center and personal notification preferences are explicitly exempt personal-account functionality.
2. Type checking was left to CI as required by `.superpowers/sdd/tasks-constraints.md`.
3. The message-catalog test timed out once while several tests shared the VPS; its isolated retry passed all 105 tests.
