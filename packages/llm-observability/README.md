# @shepherdjerred/llm-observability

OpenTelemetry tracing for LLM calls: thin wrappers that emit `gen_ai.*` spans
around provider SDK calls, plus an archive span processor that offloads large
prompt/response bodies to S3 so the trace backend (Tempo) only ever receives
slim spans with an archive reference. Consumers include
[packages/temporal](../temporal/) and
[packages/pr-fleet-controller](../pr-fleet-controller/).

## Wrappers

Each wrapper takes the caller's own SDK invocation (the SDKs are optional peer
dependencies — nothing is bundled) and records one span following the OTel
GenAI semantic conventions: `gen_ai.system`, `gen_ai.operation.name`,
`gen_ai.request.model` / `max_tokens` / `temperature` / `top_p`,
`gen_ai.response.model` / `id` / `finish_reasons`, and
`gen_ai.usage.input_tokens` / `output_tokens` / cache read + creation tokens.
Message bodies go on `gen_ai.input.messages` / `gen_ai.output.messages` (to be
stripped by the archive processor).

| Export                                                                         | Traces                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `traceClaudeAgent` (`./wrappers/claude-agent`)                                 | A Claude Agent SDK message stream (async generator) |
| `attachCodexTrace` (`./wrappers/codex`)                                        | A Codex exec session, spans per turn/tool call      |
| `createCodexJsonlParser`, `pumpCodexStdout`, `addCodexUsage` (`./codex-jsonl`) | Codex JSONL event stream parsing                    |
| `traceTextStream` (`./wrappers/text-stream`)                                   | A generic streamed text response                    |

All of these are re-exported from the package root; the per-wrapper subpaths
listed above exist so a consumer only type-checks against the peer SDKs it
actually uses.

Neither native SDK contributes to `llm_cost_usd_total`. Both bill against a
subscription rather than per call, so a cost figure from either would be an
API-equivalent price mixed into the same series as real OpenRouter charges.
They record tokens instead. `llm.cost_usd` remains on the Claude Agent span as a
provider-reported fact for reading a single trace.

Direct provider-SDK wrappers (Anthropic, OpenAI, Gemini, and the `claude` CLI)
are gone: every model call in the repository now goes through OpenRouter via
the AI SDK, so those calls are instrumented by
`RepositoryOpenTelemetry` (`./ai-sdk-telemetry`) and the `withLlmSpan` /
`setLlmResponseAttributes` primitives in `./span-helpers` rather than by a
per-provider wrapper.

## Subject attribution

`./subject` carries the vocabulary for _who_ a call was made on behalf of:
`LlmSubject` is a `{ kind, id }` pair over `discord_user`, `guild`,
`tracked_player`, and `system`. Not every workload has a requester — match
reports are generated for a tracked player and scheduled betting runs for a whole
guild — so the kind travels with the id rather than every caller pretending to
have a user.

`withLlmSubjectSpan(name, subject, fn)` opens an **active** span carrying those
attributes. Activeness is the point, not a detail: `@shepherdjerred/llm-runtime`
reads `trace.getSpan(context.active())` when it builds a call's attribution
headers, so a call made outside an active span reaches OpenRouter with no trace
id and its cost log cannot be joined back to the span that names the subject.

The subject also travels through OpenTelemetry context, and `RepositoryOpenTelemetry`
stamps it onto every `gen_ai.*` span it opens. This is not a convenience: OTel
does not propagate attributes down a trace, and usage lands on the `gen_ai.*`
spans rather than on the attribution span above them. Without the context hop, a
query grouping by subject and summing tokens would be reading two different
spans and would return nothing. Calls made outside an attribution span carry no
subject attributes at all, so unattributed work stays visibly unattributed.

Subject ids are span attributes only. They must never become Prometheus labels —
the LLM metrics carry bounded service/workload/provider/model/outcome labels by
design, and Tempo is already the store for trace, session, and user ids.

## Archive pipeline (slim spans)

`LlmArchiveSpanProcessor` (`./span-processor`) wraps an inner `SpanProcessor`
(typically a `BatchSpanProcessor` over an OTLP exporter). On span end, if the
span carries known LLM body attributes (OTel GenAI keys, Codex tool
stdout/stderr, or Vercel AI SDK legacy keys), it:

1. Builds one JSON envelope from the body attributes (request + response +
   usage),
2. redacts obvious secrets (`redactSecrets`),
3. gzips and PUTs it to S3 under a deterministic key
   (`buildArchiveKey`/`uploadArchive` — SigV4-signed, path-style capable, so
   SeaweedFS works), and
4. forwards a copy of the span with bodies stripped and `llm.archive.*`
   attributes added (bucket, key, sha256, sizes, status).

Spans without body attributes pass through unchanged; a `sampleRate` can skip
archiving (bodies are still stripped). `buildArchiveSpanProcessor` +
`loadLlmObservabilityConfig` assemble the processor from environment
configuration.

## Development

```bash
bun run test           # unit tests + e2e runner tests
bun run test:e2e       # full e2e: docker compose (Tempo + MinIO) + assertions
bun run test:e2e:debug # keep the compose stack up, watch mode
bun run typecheck
bun run lint
```

The e2e suite (`test/e2e/`) runs real OTLP export into Tempo and real S3
uploads against the compose stack in `test/e2e/compose.yaml`, then verifies
both the slim span in Tempo and the archived envelope in the bucket.
