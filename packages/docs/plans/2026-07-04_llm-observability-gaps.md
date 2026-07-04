# Fill LLM Observability Gaps — 100% Coverage

## Status

Planned — all file/line claims re-verified against live main 2026-07-04

## Decisions

- Skip monarch (laptop CLI; accepted exclusion, documented)
- Skip scout Mastra (follow-up todo only — desired end state: register the agent on a `Mastra` instance with `Observability` + `OtelExporter` pointed at scout's OTLP endpoint. NOTE: earlier citations of `sandbox/poc/mastra-dual-obs` and `packages/docs/decisions/2026-07-03_mastra-default-agent-sdk.md` are STALE — neither exists in the live tree; the follow-up todo must not reference them)
- Exclude temporal readme-refresh codex (buried inside cog; unreachable)
- One PR for the whole themed change (user preference)

## Design

### llm-observability package — new CLI support

1. **`claude-message-schemas.ts`** (internal): extract the `ResultMessageSchema`/`ResultUsageSchema` Zod schemas currently private to `claude-agent-wrapper.ts` so both the SDK wrapper and the new CLI wrapper share them.
2. **`claude-cli-wrapper.ts`** — `traceClaudeCli(metadata, outcome): void`
   - `metadata: { service, callSite, request: { model, prompt, options? } }`
   - `outcome: { stdout, exitCode, startTimeMs, endTimeMs }` — post-hoc span with explicit `startTime`/`end(endTime)`; covers both `--output-format json` (whole) and `stream-json` (scan for last `type:"result"` line) with ONE api and zero churn to how activities pump output.
   - Span: `gen_ai.chat`, `gen_ai.system: "claude_code_cli"` (distinguishes subscription-billed CLI from API-billed `anthropic` in archive keys + billing queries), usage incl. cache tokens, `llm.cost_usd`, `llm.claude_code.num_turns`, error status when `is_error`/nonzero exit.
   - Bodies: `gen_ai.input.messages` = prompt as single user message; `gen_ai.output.messages` = final result text. (Full transcript capture = future work.)
   - Telemetry-must-not-break-work rule: parse failure emits a span with `llm.cli.parse_error` + warn, never throws.
3. **`codex-jsonl.ts`** — promote dpp's parser/bus verbatim (already generic).
4. **`codex-trace.ts`** — promote dpp's adapter, generalized: `attachCodexTrace(parser, { service, callSite, model, spanPrefix?, rootAttributes?, initialPrompt? })` → `{ end() }`. Span names `<prefix>.run/.turn/.tool` (default `codex.agent`); turn spans carry gen_ai bodies/usage (incl. `reasoning_tokens`, cached tokens) exactly as dpp's does today.
5. Barrel exports in `index.ts` following the existing no-re-exports workaround (wrapper fns + `Identity<T>` aliases); add `./wrappers/claude-cli` + `./wrappers/codex` to package.json exports.
6. Unit tests with an in-memory span recorder: result-parse (json + stream-json + garbage), timing override, error status, codex adapter fed synthetic events (turn usage totals, tool spans, end() idempotence).

### temporal integrations

| Site                                                         | Change                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activities/agent-task.ts` claude branch (:395)              | capture start/end ms around `runTrackedAgentSubprocess`; call `traceClaudeCli` with parsed-stdout outcome                                                            |
| `activities/agent-task.ts` codex branch                      | create package codex parser + `attachCodexTrace` before spawn; `parser.push(line)` inside existing `onStdoutLine`; `end()` after exit                                |
| `activities/pr-babysit/iteration.ts` (:252)                  | same as claude branch                                                                                                                                                |
| `activities/homelab-audit.ts` (:335)                         | `traceClaudeCli` after existing parse (usage already extracted for Prom — unchanged)                                                                                 |
| `activities/scout-season-refresh-claude.ts` (:264)           | same                                                                                                                                                                 |
| `pr-review/specialists/runner.ts:434` + `correctness.ts:300` | wrap `client.messages.parse(...)` in `traceAnthropic` at the call sites (mirrors `summary.ts:210`); callSite = `pr-review-specialist:<id>` / `pr-review-correctness` |

### birmel

`voltagent/message-stream.ts`: widen local `StreamTextResponse` type to declare `usage: Promise<...>` + `finishReason: Promise<...>` (fields verified on VoltAgent's `StreamTextResultWithContext`); after the stream loop `await response.usage` / `response.finishReason` and return `inputTokens`/`outputTokens`/`finishReason` from the collector.

### dpp

- `observability/tracing.ts`: remove manual `context.setGlobalContextManager` (:77-79); pass the `AsyncLocalStorageContextManager` via `NodeSDK({ contextManager })` — kills the boot-time "duplicate registration of API: context" warning that masked the real July 3 failure.
- Migrate `goal/codex-trace.ts` + `goal/codex-jsonl.ts` to the promoted package modules (thin local shim passing `spanPrefix: "pokemon.goal"` + dpp root attrs); delete duplicated logic.
- Primary July 3 bug already fixed on main (`f36643fed` linker pin) — verify on next goal run.

### Phase 0 — fixture capture (de-risk, before wrapper code)

- Capture real `claude -p --output-format stream-json --verbose` stdout from one cheap local run (haiku, trivial prompt) → commit as unit-test fixture alongside a `--output-format json` variant.
- Capture real codex JSONL (one local `codex exec --json` run, or extract from dpp's existing logs) → fixture for the promoted adapter tests.
- Wrappers are written against these fixtures, not hand-written approximations. (Confirmed: temporal's codex invocation already passes `--json` — `agent-task-command.ts:86` — so no invocation changes needed.)

### Verification

1. Per touched package: `bun run typecheck`, `bun test`, `bunx eslint . --fix`
2. Package unit tests cover new wrappers (driven by Phase 0 fixtures)
3. **Immediate live check (do not wait for cron):** trigger `scripts/run-homelab-audit-local.ts --sections=1 --haiku` with telemetry env pointed at real OTLP/S3 over Tailscale, and a one-off agent task via `schedule-agent-task.ts`; then Tempo TraceQL `{ span.gen_ai.system = "claude_code_cli" }` + `aws s3 ls s3://llm-archive/llm/temporal-worker/claude_code_cli/ --profile seaweedfs` (queries proven this session)
4. birmel envelope `usage` non-empty after next Discord AI message (user can trigger on demand)
5. Follow-up todos: scout Mastra end state; dpp post-deploy goal-run verification; **tokens→dollars cost rollup (dashboard/metrics joining llm-models catalog) — deliberately out of scope for this PR**

## Context

`@shepherdjerred/llm-observability` is verified working end-to-end (Tempo slim spans + S3 archive envelopes) for scout-backend and birmel. Verified gaps blocking "100% observability" (billing-motivated):

| Gap                                                          | Evidence                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| temporal CLI workloads (`claude -p` / `codex exec`) untraced | agent tasks, homelab audit, scout season refresh, pr-babysit, readme-refresh — zero gen_ai spans                         |
| temporal pr-review specialists untraced                      | `makeSpecialistClient`/`makeCorrectnessClient` call `client.messages.parse` directly (runner.ts:497, correctness.ts:369) |
| dpp tracing broken since ~Jun 21                             | Jul 3 goal run produced 0 spans/archives; startup error: duplicate registration of API: context                          |
| birmel usage empty                                           | traceTextStream collector returns text only — no tokens → invisible to billing                                           |
| scout Mastra agent untraced                                  | report-query-agent.ts has no telemetry                                                                                   |
| monarch fully untraced                                       | @anthropic-ai/sdk direct, no OTel at all                                                                                 |

## Exploration findings (Phase 1)

### temporal (complete)

- **Archive processor is already the root span processor** (`observability/tracing.ts:141-197`) — any new `gen_ai.*`-bearing span is archived automatically; no tracing.ts changes needed.
- **Claude CLI paths already extract usage/cost** via `shared/claude-result.ts:53` `parseClaudeResultMessage` (usage, `total_cost_usd`, `num_turns`) — currently discarded (agent-task) or sent only to Prom counters (homelab-audit, scout-refresh). Missing piece = emit a `gen_ai.chat` span from parsed results.
- Five Claude CLI call sites, two spawn styles:
  - via `runTrackedAgentSubprocess` (`shared/agent-subprocess.ts:271`, line-pumped stream-json): `agent-task.ts:249`, `pr-babysit/iteration.ts:191`
  - hand-rolled whole-stdout `--output-format json`: `homelab-audit.ts:258`, `scout-season-refresh-claude.ts:229`
- **Codex**: NDJSON never parsed for usage anywhere. agent-task codex path reads only `--output-last-message` file (no usage). `readme-refresh.ts:90` codex is buried inside `cog` → unreachable at temporal layer (accept as exclusion).
- **Specialists trivially wrappable**: `runner.ts:434` + `correctness.ts:300` call `client.messages.parse` with model/max_tokens/system/messages all in hand; mirror `summary.ts:210` traceAnthropic pattern; cleanest injection = inside `makeSpecialistClient` (runner.ts:497) / `makeCorrectnessClient` (correctness.ts:369).
- **Reusable building block**: `claude-agent-wrapper.ts:93` accumulator already parses the exact same NDJSON shapes as CLI stream-json; factor into a shared helper drivable from line callbacks or a parsed result message.

### discord-plays-pokemon (complete)

- **July 3 regression root-caused and already fixed on main**: bun ≥1.3 silently switched to the isolated linker for the nested dpp workspace after the 2026-07-03 Dagger cache wipe → **two copies of `@opentelemetry/api`** → `codex-trace.ts:53`'s `trace.getTracer()` resolved a no-op tracer while NodeSDK registered the provider on the other copy → zero spans/archives despite codex running. Fix: commit `f36643fed` (Jul 4) pins `linker = "hoisted"` in `packages/discord-plays-pokemon/bunfig.toml:9`. **Remaining: verify next goal run archives; no code change needed for the primary bug.**
- **Latent secondary bug worth fixing**: `tracing.ts:77-79` manually calls `context.setGlobalContextManager` AND `NodeSDK.start()` (`:107`) registers its own → benign "duplicate registration of API: context" warning on every boot that masks real failures. Fix: pass the context manager into `NodeSDK({contextManager})` or drop the manual block.
- **codex-trace adapter is cleanly generalizable**: core loop (JSONL bus → root/turn/tool spans, `gen_ai.usage.*` mapping incl. reasoning + cached tokens, loose ExecCommand matching) has no dpp assumptions. Coupling is shallow: hardcoded `pokemon.goal.*`/`pokemon.tool.*` span names + 4 dpp-specific root attrs. Generic extraction = parameterize span-name prefix + root-attr record.
- `codex-jsonl.ts` parser (permissive Zod, `turn.started`/`turn.completed{usage}`/`item.completed agent_message`/`other`/`parse_error`, running usage total, pump from ReadableStream) is the reusable transport half.

### birmel / scout / monarch (complete)

- **birmel — ~5-line fix.** `message-stream.ts:75-106` collector returns only `{text}`. VoltAgent's `StreamTextResultWithContext` (node_modules/@voltagent/core dist/index.d.ts:9278-9292) exposes `usage: Promise<LanguageModelUsage>` (`inputTokens`/`outputTokens`) + `finishReason`. Await both after the stream loop, return them; widen local `StreamTextResponse` type (`message-stream.ts:23-37`). Note: `totalUsage` is NOT exposed by VoltAgent's wrapper — use `.usage`.
- **scout Mastra** — bare `new Agent(...)` + `agent.stream(...)` (`report-query-agent.ts:86-107`), no Mastra instance → zero spans by design. Usage already goes to Prometheus (`output.totalUsage`, :132-139). Least-invasive future fix: register agent on a `Mastra` with `Observability` + `OtelExporter` → scout's existing OTLP endpoint. **Caveat: Mastra's OtelExporter runs its own pipeline → spans reach Tempo but bypass scout's archive processor (no S3 bodies).** Low volume (one interactive HTTP route). (Prior POC/decision-doc citations removed — not present in live tree.)
- **monarch** — local laptop CLI (`monarch-classify`, interactive, MailMate/Playwright), zero OTel deps, no deployment. Two non-streaming `messages.create` sites: `claude.ts:138`, tier3 tool loop `tier3.ts:184`. Would need full OTel bootstrap + forceFlush-on-exit + Tailscale-reachable S3/OTLP → archive-only at best.
