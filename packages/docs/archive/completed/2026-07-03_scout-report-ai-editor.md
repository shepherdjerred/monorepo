---
id: plan-2026-07-03-scout-report-ai-editor
type: reference
status: complete
board: true
verification: agent
disposition: active
---

# Scout Report AI Editor

## Scope

- Format Scout report query display in the web report detail page.
- Add common report presets to the create-report page.
- Add a Mastra-backed AI report editor with streaming browser progress.
- Add abuse controls and visible quota state for AI edits.

## Decisions

- Use Mastra `Agent` and tools in the backend, with model default
  `openai/gpt-5.5` configurable via `REPORT_AI_MODEL`.
- Keep the agent tools read-only and report-scoped: language reference,
  validation, bounded preview, and formatter.
- Stream progress over a dedicated authenticated POST endpoint using SSE
  framing because tRPC mutations do not fit this progressive response shape.
- Enforce low-frequency usage with in-memory minute/hour/day/week buckets:
  user+guild, guild, and global scopes, plus one active user+guild run.
- Reuse shared Zod schemas from `@scout-for-lol/data` for request, status,
  quota, progress events, previews, and final drafts.

## Verification

- `bun test src/model/report-query-format.test.ts`
- `DATABASE_URL=file:./test.db bun test src/reports/ai/rate-limit.test.ts`
- `bun run typecheck` in `packages/data`
- `bun run typecheck` in `packages/backend`
- `bun run typecheck` in `packages/app`
- `bun run lint` in `packages/data`
- `bun run lint` in `packages/backend`
- `bun run lint` in `packages/app`
- `bun run build` in `packages/app`
- PinchTab browser pass against the Vite app with a local mock backend
- Demo artifacts in `.tmp/demo-media/`:
  - `01-create-report-page.png`
  - `02-preset-filled.png`
  - `03-ai-streaming.png`
  - `04-ai-final-draft.png`
  - `05-ai-draft-applied.png`
  - `06-report-detail-formatted-query.png`
  - `scout-report-ai-demo.mp4`

## Session Log — 2026-07-03

### Done

- Added shared report AI schemas, stream event types, quota status types, common
  presets, and parser-backed query formatting in `packages/scout-for-lol/packages/data`.
- Added Mastra backend support, feature flag/config, rate limits, metrics,
  authenticated SSE route, tRPC quota/status query, and bounded preview tools.
- Added create-report common presets, AI editor UI with streaming progress and
  quota display, and formatted query display on report detail.
- Added focused tests for query formatting/presets and report AI quotas.
- Captured PinchTab screenshots and a 12 second MP4 demo for the create-report,
  AI edit, applied draft, and formatted report-detail query states.
- Opened draft PR #1387 and uploaded the demo media to the public PR asset
  bucket.

### Remaining

- No live OpenAI call was run; the implementation is verified by typecheck,
  lint, tests, app build, and a mocked browser UI pass.

### Caveats

- `ai_reports_enabled` defaults off except the existing `MY_SERVER` override.
- Quotas are in-memory and fit the current single-replica deployment; move them
  to durable storage before scaling the backend horizontally.
- Vite build still reports the existing init-theme script and large chunk
  warnings.
- PinchTab demo used a local mock backend for auth, quota, preview, and SSE
  events, not Discord OAuth or a live OpenAI provider call.
