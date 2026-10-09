# Issue 42: scheduled nudge acceptance evidence

This extends the original issue-42 implementation at `0a4962d2c054c94da46bcc208e09710769da39cd`; it does not replace or claim the existing notification-preferences work by Luchistack in PR #66 / issue #43.

## Reproduce

From the repository root, with its TypeScript development dependency installed:

```sh
node evidence/issue-42/run.cjs
```

The captured run used Node 22.16.0 and TypeScript 5.8.3 from the cloud container, with `NODE_PATH` pointing at the existing global installation. No packages were installed and no backend requests were sent.

- [Actual terminal recording](terminal.cast): asciinema v2, captured from a real PTY execution; replay with `asciinema play evidence/issue-42/terminal.cast`.
- [Terminal preview](terminal.svg): rendered from the captured output, not a browser or live-backend screenshot.
- [Exact captured output](after.txt): nine focused checks passed, process exit 0.
- [Original reset-race reproduction](before.txt): six checks passed and the reset-race check failed before cancellation was moved ahead of asynchronous deletion.

## Acceptance coverage

The focused runner transpiles and executes the actual service, controller, preference store, and existing preferences-tool source. API responses, session-store operations, Nest decorators, clock, and timer are isolated test doubles. This is not a full Nest build, type check, HTTP integration run, or live deployment.

The nine checks cover the six-hour scheduler callback and teardown; rent, draft and dispute conditions; default opt-out; owner-scoped sessions; expiry; pending-fetch cancellation; non-overlapping polls; failed-write retry and deduplication; reset ordering; and acknowledged category, channel and timezone quiet-hours preferences from the existing tool. A failed backend preference save cannot replace the last acknowledged local settings.

## Runtime behavior and boundaries

The endpoint `POST /chat/:sessionId/nudges` requires a bearer token and `{ "enabled": true }` or `{ "enabled": false }`. It controls only in-session reminders, not email, SMS, push, payments or external account actions. Explicit consent expires after 24 hours without an authenticated session refresh, and all active consent is cleared on restart. Reset cancels pending notification fetches before awaiting session deletion; an already-started storage write is not claimed to be retractable.

The shared `MemoryModule` mirror observes successful calls through `SetNotificationPreferencesTool` in this process, using backend-acknowledged values. It honors `in_app`, `rent_reminders`, `lease_drafts`, `disputes`, and quiet-hour timezone windows before an append. Keys are token hashes, not raw tokens. Invalid quiet-hour settings suppress delivery. The mirror holds at most 1,024 identities; capacity exhaustion suppresses new deliveries until restart instead of discarding an opt-out.

The mirror is not a distributed backend preferences cache. Changes made outside this process, including another service replica, require a shared authoritative preference-read contract to be visible here. The existing backend client exposes a preference write but no preference read. This limitation is explicit; session opt-in is still required independently. Delivery uses the authenticated user's existing notification feed and does not infer new lease or dispute records.
