---
id: plan-2026-07-03-scout-report-ai-editor
type: reference
status: complete
board: false
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
