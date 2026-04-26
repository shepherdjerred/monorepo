# Birmel Remediation Follow-ups (2026-04-25)

Tracking doc for the post-deploy verification and remaining cleanups from the
Birmel remediation landed on 2026-04-25.

## What landed

A 30-day audit found that birmel was barely functional: 23 user messages, 2
successful Discord tool calls, 32 pod restarts, 505 errors (mostly scheduler
network blips on a couple of bad days), and ≥6 fatal `AI_APICallError`
events from the GPT-5 reasoning-item replay bug. Tempo had zero traces from
birmel for the entire window.

The remediation shipped the following, all green at code level (typecheck,
lint, 101 tests, Dagger smoke, CI pipeline emission, CDK8s synth, live
Tempo OTLP probe from the pod):

| #   | Area                                                                                                                                                                                                                                                                                                                            | Key files                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | OTLP traces — wired OTel diag through our logger, explicit `BatchSpanProcessor` with `forceFlush` on shutdown                                                                                                                                                                                                                   | `packages/birmel/src/observability/tracing.ts`                                                                                                                                                                                                          |
| 2   | GPT-5 reasoning replay — added `OPENAI_RESPONSES_PROVIDER_OPTIONS` (`store: false` + `include: ["reasoning.encrypted_content"]`) at every `streamText` layer, plus a load-time sanitizer that drops legacy reasoning parts lacking `encryptedContent`                                                                           | `voltagent/openai-provider-options.ts`, `voltagent/memory/sanitize.ts`, `voltagent/agents/hooks.ts`, `voltagent/agents/routing-agent.ts` (uses `createSubagent` to propagate `providerOptions` through `delegate_task`), `voltagent/message-handler.ts` |
| 3   | Tools never fired (~91% of messages) — rewrote supervisor system prompt to be explicit about delegation; turned all 6 sub-agents into factories with persona + memory + per-agent tool guidance; added per-persona Agent cache; tool invocations now log a structured `tool invoked` line                                       | `voltagent/agents/system-prompt.ts`, `voltagent/agents/specialized/*.ts`, `voltagent/agents/routing-agent.ts`, `observability/tracing.ts`                                                                                                               |
| 4   | Memory robustness — replaced `catch {}` swallows with logged warns; eliminated the duplicated channel-history injection (VoltAgent's auto memory does it)                                                                                                                                                                       | `voltagent/memory/index.ts`, `voltagent/message-handler.ts`                                                                                                                                                                                             |
| 5   | Discord channel coverage — new `channel-resolver.ts` with `narrowToSendable`/`narrowToTextBased`; threads, announcements, voice text, DMs all work; thread create supports announcement channels                                                                                                                                | `agent-tools/tools/discord/channel-resolver.ts`, `agent-tools/tools/discord/message-actions.ts`, `agent-tools/tools/discord/thread-actions.ts`                                                                                                          |
| 6   | Editor agent CLIs in image — `buildImageHelper` learned `installEditorClis`; birmel image gets `gh` (`GH_CLI_VERSION`) and `claude` (`CLAUDE_CODE_VERSION`); smoke test fails build if either is missing from `$PATH`                                                                                                           | `.dagger/src/image.ts`, `.dagger/src/misc.ts`, `scripts/ci/src/catalog.ts` (`EDITOR_CLI_PACKAGES`), `scripts/ci/src/steps/images.ts`                                                                                                                    |
| 7   | Scheduler resilience — new `runScheduledJob` wrapper with timeout, abort-signal threading, transient-failure classification (DNS/abort → warn), escalation to error after 3 consecutive failures, Sentry capture                                                                                                                | `scheduler/utils/job-runner.ts`, `scheduler/jobs/activity-aggregator.ts`, `scheduler/jobs/birthday-checker.ts`                                                                                                                                          |
| 8   | Mastra → VoltAgent cleanup — `src/mastra/` → `src/agent-tools/` (61 files, history preserved via `git mv`); `MastraConfigSchema` → `AgentConfigSchema`; `MASTRA_MEMORY_DB_PATH` → `MEMORY_DB_PATH` (with legacy fallback); studio Service+TailscaleIngress+port 4111 removed; legacy alias exports deleted; CLAUDE.md rewritten | `src/config/schema.ts`, `src/config/index.ts`, `packages/homelab/src/cdk8s/src/resources/birmel/index.ts`, `packages/birmel/CLAUDE.md`, `.env.example`, `tests/setup.ts`                                                                                |

## Post-deploy verification (24-hour window)

After the new image rolls via ArgoCD, run these against Loki / Tempo and
expect the indicated results. The "before" numbers are what the 30-day
audit produced.

| Check                     | Loki / Tempo query                                                                                       | Before          | Expected after                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------- |
| Fatal AI errors gone      | `sum(count_over_time({app="birmel"} \|~ "AI_APICallError" [24h]))`                                       | ≥6 / 30d        | 0                                                                                                          |
| Tools actually fire       | `sum(count_over_time({app="birmel"} \|~ "Message sent" [24h]))` plus `\|~ "tool invoked"` for new format | 2 / 30d         | ≫ 2/day, distributed across guilds                                                                         |
| OTLP works                | Tempo: `service.name=birmel` traces in last 1h                                                           | 0 / 30d         | non-empty, with full agent → sub-agent → tool span tree                                                    |
| OTLP success log          | `count_over_time({app="birmel"} \|~ "OTLP trace export succeeded" [1h])`                                 | n/a             | ≥ 1 (only logged on first batch — its absence after 5 min of uptime means exporter still failing silently) |
| Editor CLIs present       | `count_over_time({app="birmel"} \|~ "feature will not work" [24h])`                                      | 1 per restart   | 0                                                                                                          |
| Scheduler errors collapse | `sum by (module) (count_over_time({app="birmel"} \| json \| level="error" [24h]))`                       | 247 + 250 spike | < 5 (only true persistent failures, after 3 transient retries)                                             |

Loki should also show a new structured log per tool call:
`tool invoked` with `module: observability.tracing`, `toolId: "<id>"`,
optionally `guildId`. Use this to count tool fires even without Tempo.

## Remaining cleanups (intentionally deferred)

These shipped as compatibility shims rather than hard cuts. Address each
once the new image has soaked for a rollout cycle.

1. **Drop the legacy env-var fallback.** `packages/birmel/src/config/index.ts`
   currently reads `Bun.env["MEMORY_DB_PATH"] ?? Bun.env["MASTRA_MEMORY_DB_PATH"] ?? "file:/app/data/birmel-memory.db"`.
   The deployment chart sets only `MEMORY_DB_PATH`, so the fallback is dead
   weight after the rollout completes. Drop the `MASTRA_MEMORY_DB_PATH`
   branch and the surrounding comment.

2. **Rename the on-disk SQLite file.** The deployment env keeps
   `MEMORY_DB_PATH=file:/app/data/mastra-memory.db` to avoid stranding the
   production memory DB. Once verified working, either:
   - Rename the file in-place on the PVC (zero-downtime: shut bot, `mv`,
     start with `MEMORY_DB_PATH=file:/app/data/birmel-memory.db`), OR
   - Leave the legacy filename forever; document that the on-disk name is
     historical.
     See `packages/homelab/src/cdk8s/src/resources/birmel/index.ts:115` for
     the env-var setting.

3. **Tighten `src/config/schema.ts` historical comments.** The doc comment
   in `AgentConfigSchema` mentions the deprecated Mastra Studio for context.
   Once nobody is reading the migration history, remove that paragraph.

4. **Pre-existing `.dagger/` TypeScript errors** surfaced during this
   work, unrelated to the remediation:
   - `.dagger/src/__tests__/ci.test.ts:1` and `constants.test.ts:1` —
     `Cannot find module 'node:test'` / `'node:assert/strict'`. Likely
     missing `@types/node` in `.dagger/` workspace, or test runner
     mismatch.
   - `.dagger/src/misc.ts:172` — `error.exitCode/stdout/stderr` accessed
     on the inferred `Error` type. Needs a Zod parse or proper narrowing.

5. **`@anthropic-ai/claude-code` install location.** `withEditorClis` runs
   `bun add -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}` which
   places `claude` under `$BUN_INSTALL/bin`. Confirm this directory is on
   `$PATH` in the production image — the smoke test does
   `command -v claude` so it would have failed if not, but worth a
   one-line check after first deploy.

## Operational notes

A few things future agents should know:

- **Tempo OTLP HTTP at `http://tempo.tempo.svc.cluster.local:4318/v1/traces`
  is reachable from the birmel pod and accepts JSON-encoded protobuf.**
  Live-verified via a `fetch` from inside the pod returning
  `{"partialSuccess":{}}` (200 OK) on an empty `resourceSpans` payload.
  If Tempo traces are missing, the failure is on the bot side (exporter
  config, transport, batcher) — not networking, not Tempo.

- **The Bun base image (`oven/bun:1.3.13`) is debian-based.** `apt-get`
  works; alpine `apk` does not. `withEditorClis` in `.dagger/src/image.ts`
  installs `gh` from the official tarball (`curl + tar`) and `claude` via
  `bun add -g`.

- **`OPENAI_RESPONSES_PROVIDER_OPTIONS` must be threaded at every layer.**
  VoltAgent's `Agent` constructor does not accept `providerOptions` (it's
  per-call only). Sub-agents get them via `createSubagent({ ..., method:
"streamText", options: { providerOptions: ... } })` so the supervisor's
  internal `delegate_task` invocation propagates them. The top-level
  `streamText` call in `message-handler.ts` also passes them explicitly.
  If you add a new agent, do both.

- **`onHandoffComplete: bail()` is intentional.** It returns the sub-agent's
  text directly to Discord without a supervisor restyle round-trip. Persona
  is injected into every sub-agent specifically because of this — without
  the persona block on each sub-agent, delegated responses would lose the
  owner's voice.

- **Reasoning replay correctness depends on memory adapter round-trip.**
  The libSQL adapter stores `message.parts` as JSON, which preserves
  `providerMetadata` including `reasoningEncryptedContent`. The
  `sanitizeReplayHook` is a defensive layer for legacy rows that lack
  `encryptedContent` — once those rows age out (or are migrated/cleared),
  the hook becomes a no-op but should stay as a guard.

## Suggested follow-up agent

Schedule a one-shot agent in 14 days to run the post-deploy queries above
and either confirm green or open a follow-up issue. Concrete prompt:

> Pull the metrics from
> `packages/docs/guides/2026-04-25_birmel-remediation-followups.md` ("Post-deploy
> verification") against current Loki/Tempo. For any check still red, link
> the relevant log/trace and propose a fix.
