---
id: reference-completed-2026-05-19-llm-observability
type: reference
status: complete
board: false
---

# LLM Observability — Tempo Spans + S3 Archive

## Implementation Note — Traceloop pivot (2026-05-19)

The original plan adopted `@traceloop/instrumentation-openai` / `@traceloop/instrumentation-anthropic` for auto-instrumentation. Step 0 verification confirmed Traceloop **does not work under Bun for ESM SDKs**: `@opentelemetry/instrumentation` patches modules via `import-in-the-middle`, which requires Node's `--experimental-loader` hook; Bun does not expose that hook. OpenAI SDK v6+ is ESM-only, so no spans are emitted.

Pivoted to **manual wrappers for every SDK** (`@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, `@anthropic-ai/claude-agent-sdk`). Each wrapper is ~60 LOC, emits canonical `gen_ai.*` attributes, and is consumed by the same `LlmArchiveSpanProcessor`. The Vercel AI SDK path keeps using `@ai-sdk/otel` (it emits spans from inside the AI SDK code, no monkey-patching). The architecture (span processor + S3 archival) is unchanged; only the per-site wiring becomes explicit (`wrapOpenAIClient(client)` instead of "Traceloop auto-instruments at startup").

## Context

Every LLM call across the monorepo (Anthropic, OpenAI, Gemini, Claude Code) currently leaves no durable record — debugging bad outputs means re-running prompts blind, cost attribution is approximate, and latency regressions surface only via scout's Prometheus token counters. This change instruments 5 server-side LLM call sites so each call emits an OpenTelemetry span with **GenAI semantic-convention attributes** to Grafana Tempo, with full request/response bodies gzipped to SeaweedFS S3. Span carries the S3 ref; S3 carries the payload.

**Implementation approach** — adopt existing OSS libraries rather than build instrumentation from scratch:

- **OpenLLMetry-JS** (`@traceloop/node-server-sdk`, Apache-2.0) — auto-instruments `@anthropic-ai/sdk`, `openai`, and Vercel AI SDK with canonical `gen_ai.*` spans
- **`@ai-sdk/otel`** — Vercel AI SDK's first-class telemetry integration for `streamText()`
- **Custom OTel `SpanProcessor`** (~150 LOC, the only meaningful code we own) — the OTel GenAI semconv v1.41 explicitly defines this pattern: intercept `gen_ai.input.messages` / `gen_ai.output.messages` attributes, gzip+PUT to S3, replace with `{bucket, key, sha256, bytes}` refs before the OTLP exporter sees them
- **Thin manual wrappers** for the two SDKs with no published JS instrumentation: `@google/generative-ai` (Gemini) and `@anthropic-ai/claude-agent-sdk`

Birmel also **migrates from `Bun.spawn(["claude", ...])` to `@anthropic-ai/claude-agent-sdk`** as part of this work. Scout-backend gets OTel bootstrapped (currently has none). 1-year S3 retention.

Rejected: Langfuse (its `LangfuseSpanProcessor` ships only to Langfuse — we'd run two backends); Helicone (proxy + their own DB — incompatible with the Tempo/SeaweedFS split). Reference: [research notes](../.claude/plans/for-temporal-scout-birmel-buzzing-gem-agent-a4f8f215e8c4427a4.md).

## Scope — call sites

| #   | File                                                                                                                      | Provider              | Coverage                           |
| --- | ------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------- |
| 1   | [packages/temporal/src/activities/pr-review/summary.ts:278](packages/temporal/src/activities/pr-review/summary.ts:278)    | Anthropic (streaming) | Traceloop auto                     |
| 2   | [packages/temporal/src/activities/deps-summary.ts:371](packages/temporal/src/activities/deps-summary.ts:371)              | OpenAI                | Traceloop auto                     |
| 3a  | [packages/scout-for-lol/.../ai-clients.ts:33](packages/scout-for-lol/packages/backend/src/league/review/ai-clients.ts:33) | OpenAI                | Traceloop auto                     |
| 3b  | [packages/scout-for-lol/.../ai-clients.ts:49](packages/scout-for-lol/packages/backend/src/league/review/ai-clients.ts:49) | Gemini                | **manual wrapper**                 |
| 4   | [packages/birmel/src/voltagent/message-stream.ts:63](packages/birmel/src/voltagent/message-stream.ts:63)                  | OpenAI (via AI SDK)   | `@ai-sdk/otel`                     |
| 5   | [packages/birmel/src/editor/claude-client.ts](packages/birmel/src/editor/claude-client.ts)                                | Claude Code           | **SDK migration + manual wrapper** |

Out of scope: scout frontend `generator.ts` (browser, user-provided keys).

## New package: `packages/llm-observability/`

```
packages/llm-observability/
  package.json                   # deps: @traceloop/node-server-sdk, @ai-sdk/otel,
                                 #       @opentelemetry/{api,sdk-trace-base,resources},
                                 #       @google/generative-ai (peer), @anthropic-ai/claude-agent-sdk (peer)
  src/
    config.ts                    # Zod LlmObservabilityConfigSchema (LLM_ARCHIVE_*, S3_*, AWS_*)
    archive-span-processor.ts    # ✦ the meaningful piece — see below
    archive-uploader.ts          # gzip + S3 PUT (lifts putS3Object from packages/temporal/src/shared/s3.ts)
    gemini-wrapper.ts            # wrapGeminiClient(model) → emits gen_ai.* spans
    claude-agent-wrapper.ts      # wrapClaudeAgentQuery(query, opts) → emits gen_ai.* spans
    init.ts                      # initLlmObservability({serviceName, tracerProvider})
    redact.ts                    # redactSecrets() — adapts packages/temporal/src/shared/redact.ts
    index.ts
  test/
    archive-span-processor.test.ts  # InMemorySpanExporter + fake S3
    redact.test.ts
    gemini-wrapper.test.ts
    claude-agent-wrapper.test.ts
```

### Archive `SpanProcessor` (the only non-trivial code we own)

```ts
class LlmArchiveSpanProcessor implements SpanProcessor {
  onStart() {}
  async onEnd(span: ReadableSpan) {
    const attrs = span.attributes;
    // Recognized keys: gen_ai.input.messages, gen_ai.output.messages,
    //                  ai.prompt.messages, ai.response.text (AI SDK legacy),
    //                  traceloop.entity.input, traceloop.entity.output
    const body = extractLlmBodies(attrs);
    if (!body) return;
    const ref = await archiveUploader.put({
      key: `llm/${span.resource.attributes["service.name"]}/${date}/${span.spanContext().traceId}-${span.spanContext().spanId}.json.gz`,
      body: gzipSync(JSON.stringify(redactSecrets(body))),
    });
    // Mutate before forwarding to OTLP exporter:
    setMutableAttrs(span, {
      "llm.archive.s3_bucket": ref.bucket,
      "llm.archive.s3_key": ref.key,
      "llm.archive.bytes_compressed": ref.bytes,
      "llm.archive.sha256": ref.sha256,
      "llm.archive.status": ref.ok ? "ok" : "failed",
    });
    stripLargeAttrs(span, BODY_ATTR_KEYS);
  }
  shutdown() {
    return archiveUploader.flush();
  }
  forceFlush() {
    return archiveUploader.flush();
  }
}
```

The processor is registered **before** the OTLP exporter in the SpanProcessor chain so Tempo only receives the slim span. S3 PUT failures degrade gracefully — `llm.archive.status="failed"` on the span, no thrown errors propagated to the LLM call.

### Manual wrappers

`wrapGeminiClient(modelInstance)` — proxies `generateContent` and `generateContentStream`; opens a `gen_ai.chat` span with `gen_ai.system="gemini"`, records prompt as `gen_ai.input.messages`, finalizes with `gen_ai.output.messages` + `gen_ai.usage.*` from the response's `usageMetadata`.

`wrapClaudeAgentQuery(query, prompt, options)` — proxies the `query()` async generator from `@anthropic-ai/claude-agent-sdk`; opens `gen_ai.chat` with `gen_ai.system="claude_code_sdk"`, accumulates SDK messages, finalizes from the terminal `result` message (model, session id, `usage.input_tokens`/`output_tokens`).

Both use the same `gen_ai.*` attribute names as Traceloop so the SpanProcessor handles them uniformly.

### S3 key layout

`llm/<service>/<YYYY>/<MM>/<DD>/<traceId>-<spanId>.json.gz`

### Public API (4 named exports)

| Function                                       | Purpose                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `initLlmObservability(opts)`                   | Registers Traceloop instrumentations + AI SDK telemetry + LlmArchiveSpanProcessor onto an existing `TracerProvider`. Called from each service's existing OTel bootstrap. |
| `wrapGeminiClient(model)`                      | Thin proxy emitting `gen_ai.*` spans for `@google/generative-ai`.                                                                                                        |
| `wrapClaudeAgentQuery(query, prompt, options)` | Thin proxy emitting `gen_ai.*` spans for `@anthropic-ai/claude-agent-sdk`.                                                                                               |
| `shutdownLlmObservability()`                   | Flushes in-flight S3 PUTs.                                                                                                                                               |

## Per-site wiring

### 1 & 2. temporal — Traceloop auto-instrumentation

**No code change at call sites.** Update [packages/temporal/src/observability/tracing.ts](packages/temporal/src/observability/tracing.ts) — after NodeSDK init, call `initLlmObservability({ tracerProvider, serviceName: "temporal" })`. Traceloop registers `@traceloop/instrumentation-anthropic` and `@traceloop/instrumentation-openai` against the existing tracer provider; spans flow through the new `LlmArchiveSpanProcessor` first, then OTLP to Tempo.

### 3. scout-backend — Traceloop (OpenAI) + manual Gemini wrapper

**New OTel bootstrap**: [packages/scout-for-lol/packages/backend/src/observability/tracing.ts](packages/scout-for-lol/packages/backend/src/observability/tracing.ts) mirroring [packages/temporal/src/observability/tracing.ts](packages/temporal/src/observability/tracing.ts) (NodeSDK + OTLP HTTP + `LoggingSpanExporter` + ECONNREFUSED demotion). Service name `scout-backend`. Initialize at top of `packages/scout-for-lol/packages/backend/src/index.ts` before other imports run, then call `initLlmObservability(...)`.

**ai-clients.ts changes**:

- OpenAI factory ([:33](packages/scout-for-lol/packages/backend/src/league/review/ai-clients.ts:33)) — no code change, Traceloop auto-instruments.
- Gemini factory ([:49](packages/scout-for-lol/packages/backend/src/league/review/ai-clients.ts:49)) — return `wrapGeminiClient(client)` instead of raw client.

### 4. birmel message-stream — `@ai-sdk/otel`

Enable Vercel AI SDK telemetry on the `streamText` call at [packages/birmel/src/voltagent/message-stream.ts:63](packages/birmel/src/voltagent/message-stream.ts:63):

```ts
agent.streamText(input, {
  ...providerOptions,
  experimental_telemetry: {
    isEnabled: true,
    recordInputs: true,
    recordOutputs: true,
  },
});
```

Register the AI SDK OpenTelemetry integration in [packages/birmel/src/observability/tracing.ts](packages/birmel/src/observability/tracing.ts) via `initLlmObservability({ tracerProvider, serviceName: "birmel", enableAiSdk: true })`. The integration emits `gen_ai.input.messages` / `gen_ai.output.messages` that the archive processor handles.

### 5. birmel editor — migrate to Claude Agent SDK + manual wrapper

**Replace the `Bun.spawn`-based implementation in [packages/birmel/src/editor/claude-client.ts](packages/birmel/src/editor/claude-client.ts).**

| Change                                                                  | File                                                                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Add dep `@anthropic-ai/claude-agent-sdk` (latest from npm at impl time) | [packages/birmel/package.json](packages/birmel/package.json)                                                         |
| Rewrite using `query({ prompt, options })` async generator              | [packages/birmel/src/editor/claude-client.ts](packages/birmel/src/editor/claude-client.ts)                           |
| Wrap the `query()` call with `wrapClaudeAgentQuery`                     | same file                                                                                                            |
| Refactor tests against SDK mocks                                        | [packages/birmel/src/editor/claude-client.test.ts](packages/birmel/src/editor/claude-client.test.ts)                 |
| Drop Claude CLI binary install (initContainer/sidecar) if present       | [packages/homelab/src/cdk8s/src/resources/birmel/index.ts](packages/homelab/src/cdk8s/src/resources/birmel/index.ts) |

`isClaudeAvailable()` / `checkClaudePrerequisites()` simplify to `ANTHROPIC_API_KEY` env check.

## Bucket bootstrap

Append to [packages/homelab/src/tofu/seaweedfs/buckets.tf](packages/homelab/src/tofu/seaweedfs/buckets.tf) alongside `sccache`/`bazel_cache`:

```hcl
resource "aws_s3_bucket" "llm_archive" {
  bucket = "llm-archive"
}

resource "terraform_data" "llm_archive_lifecycle" {
  input = {
    bucket       = aws_s3_bucket.llm_archive.id
    expire_days  = 365
    endpoint_url = "https://seaweedfs-s3.tailnet-1a49.ts.net"
  }
  provisioner "local-exec" {
    command = <<-EOT
      aws s3api put-bucket-lifecycle-configuration \
        --bucket "${self.input.bucket}" \
        --endpoint-url "${self.input.endpoint_url}" \
        --lifecycle-configuration '{"Rules":[{"ID":"expire-llm-archives","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":${self.input.expire_days}}}]}'
    EOT
  }
}
```

Apply: `op run --env-file=.env -- tofu -chdir=src/tofu/seaweedfs apply`.

## Config & deployment

Reuse existing `S3_ENDPOINT` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `S3_FORCE_PATH_STYLE`. New vars:

| Var                         | Default       | Notes                                                               |
| --------------------------- | ------------- | ------------------------------------------------------------------- |
| `LLM_OBSERVABILITY_ENABLED` | `true`        | Master switch — disables Traceloop registration + archive processor |
| `LLM_ARCHIVE_S3_BUCKET`     | `llm-archive` |                                                                     |
| `LLM_ARCHIVE_S3_PREFIX`     | `llm`         |                                                                     |
| `LLM_ARCHIVE_REGION`        | `us-east-1`   |                                                                     |
| `LLM_ARCHIVE_SAMPLE_RATE`   | `1.0`         | Knob for future high-volume services                                |
| `TRACELOOP_TRACE_CONTENT`   | `true`        | Traceloop opt-in for prompt/completion attribute capture            |

**K8s deployment updates** (inject `seaweedfs-s3-credentials` 1Password item where missing):

- [packages/homelab/src/cdk8s/src/resources/temporal/worker.ts](packages/homelab/src/cdk8s/src/resources/temporal/worker.ts) — add `LLM_ARCHIVE_*` + `TRACELOOP_TRACE_CONTENT`
- [packages/homelab/src/cdk8s/src/resources/birmel/index.ts](packages/homelab/src/cdk8s/src/resources/birmel/index.ts) — add `LLM_ARCHIVE_*` + `TRACELOOP_TRACE_CONTENT` + `S3_*`/`AWS_*` from `seaweedfs-s3-credentials`
- [packages/homelab/src/cdk8s/src/resources/scout/index.ts](packages/homelab/src/cdk8s/src/resources/scout/index.ts) — add `OTEL_*` + `LLM_ARCHIVE_*` + `TRACELOOP_TRACE_CONTENT` + `S3_*`/`AWS_*`

**Side-fix**: [packages/birmel/src/config/schema.ts:30](packages/birmel/src/config/schema.ts:30) — stale OTLP default `tempo.monitoring.svc.cluster.local` → `tempo.tempo.svc.cluster.local`.

## Sampling, redaction, error handling

- **Sampling**: 100% (`LLM_ARCHIVE_SAMPLE_RATE=1.0`). Low call volume × small payloads.
- **Redaction**: `redactSecrets()` runs on the envelope inside `LlmArchiveSpanProcessor.onEnd` before upload. Scrubs `authorization`, `x-api-key`, `Authorization`, `api_key`, `apiKey`, `Bearer <token>` substrings. Discord PII not redacted (solo homelab). Never mutate caller data — operate on a structured-clone copy.
- **Failure mode**: S3 PUT failures → `logger.warn` + `llm.archive.status="failed"` span attr; never throws. LLM call returns normally regardless.

## Bun compatibility check (must do first)

Traceloop uses `@opentelemetry/instrumentation` which monkey-patches via `require-in-the-middle`. The existing OTel SDKs in birmel/temporal run fine under Bun, so this is expected to work — but **verify before relying on it** by:

1. Run a small Bun script that imports `@traceloop/node-server-sdk` + `@anthropic-ai/sdk`, fires one `messages.create()` call, and confirms a `gen_ai.chat` span appears in an `InMemorySpanExporter`.
2. If broken, fall back: write manual Anthropic and OpenAI wrappers (mirroring the Gemini wrapper) — adds ~200 LOC but keeps the architecture identical.

This check is rollout step 0 below.

## Local e2e test harness

Lives in `packages/llm-observability/test/e2e/`. Brings up Grafana Tempo + MinIO in Docker, asserts the full pipeline (SDK call → OTel span → archive processor → Tempo + MinIO) end-to-end without touching the homelab or paying for LLM API calls.

### `packages/llm-observability/test/e2e/compose.yaml`

```yaml
name: llm-obs-e2e
services:
  tempo:
    image: grafana/tempo:2.10.0
    command: ["-config.file=/etc/tempo.yaml"]
    volumes:
      - ./tempo.yaml:/etc/tempo.yaml:ro
      - tempo-data:/var/tempo
    ports: ["3200:3200", "4317:4317", "4318:4318"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3200/ready"]
      interval: 2s
      retries: 30
  minio:
    image: minio/minio:RELEASE.2025-04-08T15-41-24Z
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
    volumes: [minio-data:/data]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 2s
      retries: 30
  minio-init:
    image: minio/mc:RELEASE.2025-04-03T17-07-56Z
    depends_on: { minio: { condition: service_healthy } }
    entrypoint: >
      /bin/sh -c "mc alias set local http://minio:9000 minioadmin minioadmin &&
      mc mb --ignore-existing local/llm-archive"
    restart: "no"
volumes: { tempo-data: {}, minio-data: {} }
```

Optional `grafana/grafana:11.5.0` UI on `:3000` for manual span inspection (datasource preloaded against Tempo on `:3200`).

### `packages/llm-observability/test/e2e/tempo.yaml`

```yaml
stream_over_http_enabled: true
server: { http_listen_port: 3200, log_level: info }
distributor:
  receivers:
    otlp:
      protocols:
        http: { endpoint: "0.0.0.0:4318" }
        grpc: { endpoint: "0.0.0.0:4317" }
ingester:
  max_block_duration: 5m
  complete_block_timeout: 10s
  trace_idle_period: 1s
compactor: { compaction: { block_retention: 1h } }
storage:
  trace:
    backend: local
    wal: { path: /var/tempo/wal }
    local: { path: /var/tempo/blocks }
overrides: { defaults: { metrics_generator: { processors: [] } } }
```

The `trace_idle_period: 1s` override is critical — default 10s makes tests flake.

### Test harness

```
packages/llm-observability/test/e2e/
  compose.yaml
  tempo.yaml
  helpers.ts                    # pollTempoTrace(), getMinioObject(), buildTestTracerProvider()
  msw-handlers.ts               # stubs for Anthropic/OpenAI/Gemini/Claude-Agent/AI-SDK HTTP
  anthropic-archive.e2e.test.ts
  openai-archive.e2e.test.ts
  gemini-wrapper.e2e.test.ts
  claude-agent-wrapper.e2e.test.ts
  ai-sdk-archive.e2e.test.ts
```

**LLM mocking**: msw v2 (works on Bun via `@mswjs/interceptors`'s `globalThis.fetch` patch). All five SDKs in scope use `fetch` exclusively. Setup in each test's `beforeAll(() => server.listen({ onUnhandledRequest: "error" }))` — never globalSetup (Bun runs that in a child process). Streaming SDKs get `text/event-stream` responses. Real SDK behaviour (retries, parsing, usage extraction) exercised; only the network hop is mocked.

**Tempo polling** (WAL gotcha): after the SDK call returns, `POST http://localhost:3200/flush`, then poll `GET /api/v2/traces/<traceID>` at 250 ms intervals until the span appears (typically 1–2 s). Helper:

```ts
async function pollTempoTrace(traceId: string, opts = { timeoutMs: 10_000 }) {
  await fetch("http://localhost:3200/flush", { method: "POST" });
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`http://localhost:3200/api/v2/traces/${traceId}`);
    if (r.ok) return await r.json();
    await Bun.sleep(250);
  }
  throw new Error(`trace ${traceId} not found within ${opts.timeoutMs}ms`);
}
```

**MinIO**: standard `S3Client` from `@aws-sdk/client-s3` (already a transitive dep) pointing at `http://localhost:9000`, `forcePathStyle: true`, creds `minioadmin`/`minioadmin`, region `us-east-1`.

### Per-test assertions (template)

For each `<provider>-archive.e2e.test.ts`:

1. Mock the provider's HTTP endpoint with a canned response (known model, usage, body).
2. Boot a `BasicTracerProvider` with `LlmArchiveSpanProcessor` + `OTLPTraceExporter` pointing at localhost Tempo.
3. Fire one SDK call. Capture the `traceId`/`spanId` from the active context.
4. `await pollTempoTrace(traceId)` — assert span has `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `llm.archive.s3_key`, `llm.archive.sha256`, and **no** `gen_ai.input.messages` / `gen_ai.output.messages` (stripped by the processor).
5. `await getMinioObject("llm-archive", span.attributes["llm.archive.s3_key"])` → `gunzip` → JSON.parse → assert `input.messages` + `output.messages` + `usage` match what the SDK saw.
6. Assert `sha256(downloaded gzip) === span.attributes["llm.archive.sha256"]`.

### Commands

`packages/llm-observability/package.json` scripts:

```json
{
  "test": "bun test test/unit",
  "test:e2e": "docker compose -f test/e2e/compose.yaml up -d --wait && bun test test/e2e ; ec=$? ; docker compose -f test/e2e/compose.yaml down -v ; exit $ec",
  "test:e2e:debug": "docker compose -f test/e2e/compose.yaml up -d --wait && bun test test/e2e --watch"
}
```

`--wait` blocks until healthchecks pass and `minio-init` exits 0. Teardown runs even on test failure (the `; ec=$? ;` pattern preserves the exit code).

### Optional: live LLM e2e

Same harness, but msw stubs swap for real API calls against cheap models (`claude-haiku-4-5`, `gpt-4o-mini`, `gemini-flash`). Gated by `LLM_E2E_REAL=1` env. Runs manually before each major release; not in CI.

```json
"test:e2e:live": "LLM_E2E_REAL=1 docker compose -f test/e2e/compose.yaml up -d --wait && bun test test/e2e/live ; ec=$? ; docker compose -f test/e2e/compose.yaml down -v ; exit $ec"
```

### CI hook

Add a Buildkite step in [scripts/ci/src/main.ts](scripts/ci/src/main.ts) (or per-package CI config) that runs `bun run --filter='./packages/llm-observability' test:e2e` against the BuildKite agent's docker socket. Tempo + MinIO containers are small (~250 MB combined); fits in standard agent budget.

## Rollout order

0. **Verify Traceloop works under Bun** (above). If broken, expand the manual-wrapper plan to cover Anthropic + OpenAI.
1. Land `packages/llm-observability/` package + unit tests (no wiring).
2. `tofu apply` bucket + lifecycle.
3. Wire temporal — `initLlmObservability` in tracing.ts. Verify via `scripts/replay-pr-summary.ts`.
4. Bootstrap scout OTel + Gemini wrapper.
5. Wire birmel `message-stream.ts` AI SDK telemetry.
6. Migrate birmel `claude-client.ts` to Claude Agent SDK + `wrapClaudeAgentQuery`.

Each step ships behind `LLM_OBSERVABILITY_ENABLED` — rollback is one env flip.

## Verification

For each wired site:

1. Trigger a real call.
2. Grafana → Explore → Tempo: `{ service.name = "<service>" && name =~ "gen_ai.*" }`. Confirm span exists, `gen_ai.usage.*` populated, `llm.archive.s3_key` present, no `gen_ai.input.messages` / `gen_ai.output.messages` bloating the span (stripped by the processor).
3. `aws --endpoint-url=https://seaweedfs.sjer.red s3 cp s3://llm-archive/<key> - | gunzip | jq '.input.messages, .output.messages, .usage'` — confirm payload integrity.
4. Cross-check span `gen_ai.usage.input_tokens` == archive `usage.input_tokens` and span `llm.archive.sha256` matches `sha256sum` of downloaded gzip.

Whole-repo gates after wiring:

```bash
bun run --filter='./packages/llm-observability' test
bun run --filter='./packages/llm-observability' typecheck
bun run --filter='./packages/temporal' typecheck
bun run --filter='./packages/scout-for-lol/packages/backend' typecheck
bun run --filter='./packages/birmel' typecheck && bun run --filter='./packages/birmel' test
```

## Critical files

- **New**: `packages/llm-observability/src/{archive-span-processor,archive-uploader,init,gemini-wrapper,claude-agent-wrapper,config,redact}.ts`
- **New**: `packages/scout-for-lol/packages/backend/src/observability/tracing.ts` (OTel bootstrap)
- **Modify**: [packages/birmel/src/editor/claude-client.ts](packages/birmel/src/editor/claude-client.ts) — SDK migration (biggest single change)
- **Modify**: [packages/birmel/src/voltagent/message-stream.ts](packages/birmel/src/voltagent/message-stream.ts) — add `experimental_telemetry`
- **Modify**: [packages/temporal/src/observability/tracing.ts](packages/temporal/src/observability/tracing.ts) — call `initLlmObservability`
- **Modify**: [packages/birmel/src/observability/tracing.ts](packages/birmel/src/observability/tracing.ts) — call `initLlmObservability`
- **Modify**: [packages/scout-for-lol/packages/backend/src/league/review/ai-clients.ts](packages/scout-for-lol/packages/backend/src/league/review/ai-clients.ts) — wrap Gemini factory
- **Modify**: [packages/homelab/src/tofu/seaweedfs/buckets.tf](packages/homelab/src/tofu/seaweedfs/buckets.tf)
- **Modify**: 3 cdk8s deployment files (env vars + `seaweedfs-s3-credentials`)
- **Side-fix**: [packages/birmel/src/config/schema.ts:30](packages/birmel/src/config/schema.ts:30)

## Reused existing utilities

- [packages/temporal/src/shared/s3.ts](packages/temporal/src/shared/s3.ts) — `putS3Object()` SigV4 helper (lift core into `archive-uploader.ts`)
- [packages/temporal/src/shared/redact.ts](packages/temporal/src/shared/redact.ts) — redaction patterns
- [packages/temporal/src/observability/tracing.ts](packages/temporal/src/observability/tracing.ts) — template for scout OTel bootstrap
- [packages/birmel/src/observability/tracing.ts](packages/birmel/src/observability/tracing.ts) — pattern reference (`LoggingSpanExporter`, batch sizing, ECONNREFUSED demotion)

## Open questions (resolve at implementation time)

- Traceloop under Bun — verify in step 0; expand manual wrappers if broken
- Latest `@anthropic-ai/claude-agent-sdk` version on npm
- Whether birmel pods currently bundle the Claude Code CLI binary (drop initContainer/sidecar if so)
- Whether VoltAgent's existing internal spans collide visually with AI SDK telemetry spans (decide presentation in Tempo at verify time; orthogonal to correctness)

## Session Log — 2026-05-19

### Done

- Built [packages/llm-observability](../../llm-observability/) with `LlmArchiveSpanProcessor`, gzip+SigV4 S3 uploader, redact helper, Zod config, and per-SDK wrappers (`traceAnthropic`, `traceOpenAi`, `traceGemini`, `traceClaudeAgent`, `traceTextStream`). 16 unit tests pass.
- E2E harness in [packages/llm-observability/test/e2e](../../llm-observability/test/e2e/): Grafana Tempo + MinIO via Docker compose, msw mocking the OpenAI HTTP endpoint, Tempo HTTP API polling, SigV4 GET of the archived object — the test confirms the full pipeline (SDK call → wrapper span → archive processor → MinIO + Tempo).
- Wired call sites:
  - [temporal pr-summary](../../temporal/src/activities/pr-review/summary.ts) → `traceAnthropic`
  - [temporal deps-summary](../../temporal/src/activities/deps-summary.ts) → `traceOpenAi`
  - [scout-backend ai-clients](../../scout-for-lol/packages/backend/src/league/review/ai-clients.ts) → `traceOpenAi` + Proxy-based Gemini wrap
  - [birmel message-stream](../../birmel/src/voltagent/message-stream.ts) → `traceTextStream`
  - [birmel claude-client](../../birmel/src/editor/claude-client.ts) → migrated from `Bun.spawn(["claude"])` to `@anthropic-ai/claude-agent-sdk` + `traceClaudeAgent`
- Tracing bootstrapped in scout-backend (new [tracing.ts](../../scout-for-lol/packages/backend/src/observability/tracing.ts)) and the archive processor wired into temporal/birmel/scout TracerProviders via `buildArchiveSpanProcessor`.
- Tofu: added `aws_s3_bucket.llm_archive` + 1-year lifecycle to [seaweedfs/buckets.tf](../../homelab/src/tofu/seaweedfs/buckets.tf).
- K8s deployments: added `LLM_ARCHIVE_*` envs to [temporal-worker](../../homelab/src/cdk8s/src/resources/temporal/worker.ts), [birmel](../../homelab/src/cdk8s/src/resources/birmel/index.ts) (with a new OnePasswordItem mirroring SeaweedFS S3 creds into the birmel namespace), and [scout](../../homelab/src/cdk8s/src/resources/scout/index.ts) (plus OTel envs for the new bootstrap).
- Side-fix: corrected the stale `tempo.monitoring.svc.cluster.local` default in [birmel config schema](../../birmel/src/config/schema.ts:30).

### Remaining

- **Apply tofu**: `op run --env-file=.env -- tofu -chdir=src/tofu/seaweedfs apply` to create the `llm-archive` bucket + lifecycle.
- **Deploy**: roll out temporal-worker, birmel, and scout-backend with the new env vars; verify in Tempo + MinIO/SeaweedFS that real calls produce spans and archive objects.
- **Optional follow-up**: now that birmel's editor uses the Claude Agent SDK directly, the `installEditorClis: true` Dagger flag in [misc.ts:223](../../../.dagger/src/misc.ts) and the `@anthropic-ai/claude-code` CLI install in [image.ts:73](../../../.dagger/src/image.ts) are unused. Removing them shrinks the image but is a follow-up commit.

### Caveats

- **Traceloop dropped**: Step-0 verification proved `@traceloop/instrumentation-*` packages can't monkey-patch ESM modules under Bun (no `import-in-the-middle` loader hook). Pivoted to explicit per-SDK wrappers. If we later move any service to Node, Traceloop becomes viable again.
- **`LlmArchiveSpanProcessor` ordering**: the wrapped processor (`buildArchiveSpanProcessor({ inner: batchProcessor })`) must be registered as the only root processor — not alongside the inner. The wrapper forwards non-LLM spans untouched.
- **Birmel SeaweedFS creds**: birmel's namespace now has its own `OnePasswordItem` (`birmel-seaweedfs-1p`, item `vet52jaeh75chsalu6lulugium`) producing a K8s secret `birmel-seaweedfs-s3-credentials`. The keys are `SEAWEEDFS_ACCESS_KEY_ID` / `SEAWEEDFS_SECRET_ACCESS_KEY` (matching the s3-static-sites convention).
- **OTel context propagation**: scout-backend's new tracing bootstrap enables `AsyncLocalStorageContextManager` explicitly. Without that, `tracer.startActiveSpan` does not carry the active context across `await` boundaries, and inner spans become orphans.
- **Sampling at 1.0**: the `LLM_ARCHIVE_SAMPLE_RATE` knob is wired but defaults to full archival across all services. Total volume is low (a few hundred calls/day) and payloads are <200 KB gzipped, so retention cost is trivial for the 1-year bucket lifecycle.
