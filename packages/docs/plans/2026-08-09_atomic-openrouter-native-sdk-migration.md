---
id: plan-atomic-openrouter-native-sdk-migration-2026-08-09
type: plan
status: in-progress
board: true
verification: operator
disposition: blocked
---

# Atomic OpenRouter and Native SDK Migration

## Summary

Deliver one repository-wide cutover to AI SDK 7 and
`@openrouter/ai-sdk-provider` 3. Ordinary text, image, embedding, tool, and
structured-output inference uses OpenRouter exclusively. General-purpose
coding and computer-use agents use Claude Agent SDK or Codex SDK directly.
Remove Mastra, VoltAgent, direct provider clients, provider subprocesses, and
ordinary direct-provider credentials without weakening existing model
metadata, evals, effect boundaries, or observability.

## Runtime contract

Add `@shepherdjerred/llm-runtime` as the thin shared boundary:

- `createOpenRouterRuntime({ apiKey, service, appName, metricsRegister })`
- catalog-aware `languageModel`, `embeddingModel`, and `imageModel` resolvers
- `callOptions({ workload, sessionId, traceContext })`
- `generateValidatedObject`, the sole higher-level inference primitive
- `OpenRouterCallMetadata`, retaining generation ID, requested and resolved
  model, upstream provider, route and region, fallback attempts, token
  breakdown, actual cost, and upstream cost

OpenRouter routing may change upstream providers but never the requested model
identity. Ordinary requests deny data collection without requiring strict ZDR,
request usage and router metadata, carry application and trace attribution,
and fail visibly for missing routes, unsupported capabilities, authentication,
policy, or credit. Structured output and tool requests require supported
parameters and strict JSON schemas. There is no response healing or emergency
direct-provider fallback.

`generateValidatedObject` uses AI SDK `generateText` with `Output.object` and
the caller's Zod schema. It allows two transport retries for retryable network,
429, and 5xx failures and three total semantic attempts. Every attempt is
traced and charged. Corrective attempts contain only bounded Zod issue
summaries. Exhaustion exposes all attempts and aggregate usage, cost, and
metadata through a typed error. It never extracts JSON from prose or fenced
text.

## Model catalog

Preserve all stable IDs, creator `provider` values, descriptions, lifecycle
status, and canonical prices in `@shepherdjerred/llm-models`. Add input/output
modalities; tool, structured-output, web-search, and reasoning capabilities;
and explicit OpenRouter, Claude Agent SDK, and Codex SDK routes. Aliases resolve
to exact OpenRouter IDs, while every generation retains requested and resolved
model/provider metadata.

The weekly catalog sync queries OpenRouter text/image and embedding catalogs in
addition to models.dev and LiteLLM. It fails when a current ordinary-inference
route disappears and keeps catalog changes reviewable instead of auto-adding
models.

## Consumer cutover

- Birmel keeps its explicit router, bounded context, one-specialist lifecycle,
  typed memory provenance, durable jobs, tool authority, and Claude Agent SDK
  editor. Ordinary models and embeddings move to the shared runtime; routing
  and memory extraction use `generateValidatedObject`.
- Scout replaces the Mastra report-query agent with AI SDK `ToolLoopAgent`,
  preserving tools, limits, budgets, and streaming events. Tools run once and
  a tool-free validated finalizer produces the structured result. Review text,
  image generation, and eval materialization use OpenRouter. The browser
  workbench stores only a locally held user-provided OpenRouter key.
- PR Fleet replaces Mastra agents, tools, and workflows with AI SDK
  `ToolLoopAgent`, `tool()`, and explicit TypeScript tick functions. Effectful
  loops are never replayed after publication or checkout mutation; a tool-free
  finalizer operates over recorded evidence.
- Temporal and repository automation move ordinary summaries to the shared
  runtime and replace active Claude/Codex subprocesses with native SDKs while
  retaining schema dialects, working directory, sandbox, tool authority,
  cancellation, heartbeat/progress, usage, cost, and no-replay semantics.
- Monarch moves Anthropic calls and handwritten JSON parsing to the shared
  runtime and AI SDK Zod tools. Optional research uses OpenRouter's
  model-controlled web-search server tool with the existing result limits.
- The Discord Pokemon benchmark keeps scenarios, scores, and artifact
  contracts. New Codex SDK events are normalized into versioned `codex.jsonl`;
  readers accept both legacy CLI and SDK records.

The external Codex GitHub review application remains outside this migration.

## Replay, eval, and effect safety

PR Fleet run-bundle schema v2 keeps hash-chained `events.jsonl` and makes a
redacted, digest-verified `spans.jsonl` the authoritative telemetry artifact.
New bundles omit `mastra.db` and `observability.duckdb`. Inspection, replay,
and dashboard readers continue to support immutable v1 bundles; no historical
bundle is rewritten.

Scout's immutable datasets, generated outputs, human ratings, transfer
checksums, and freshness checks remain unchanged. New records may add
transport, OpenRouter generation/provider, actual cost, and attempt metadata.
Scout and Pokemon retain their project-specific comparison processes instead
of adopting a generic eval framework.

Effectful native SDK agents are not replayed solely because final schema
validation fails. The caller reconciles repository or remote state and fails
for operator review. Temporal marks known completed or billed generations and
possibly applied effects non-retryable.

## Observability

Local OpenTelemetry remains authoritative. Each logical call creates a stable
repository-owned `gen_ai.*` parent span with AI SDK or native SDK spans beneath
it. Prompt, tool, and output bodies are redacted into the existing private
SeaweedFS archive; Tempo receives only slim references.

Standardize bounded-cardinality metrics across OpenRouter, Claude Agent SDK,
and Codex SDK:

- `llm_requests_total`
- `llm_request_duration_seconds`
- `llm_tokens_total`
- `llm_cost_usd_total`
- `llm_structured_output_attempts_total`
- `llm_router_attempts_total`
- `llm_openrouter_metadata_missing_total`

Preserve `ai_provider_errors_total` and `ai_provider_issue_active`, using
`provider="openrouter"` for gateway failures and separate bounded upstream
routing dimensions. Generation, trace, session, and user identifiers never
become Prometheus labels. Correlated structured logs include workload, stable
and resolved model/provider, generation ID, fallback count, tokens, cost,
trace ID, outcome, and no prompt bodies or keys.

Add an authenticated `openrouter-broadcast-ingest` service. It accepts bounded
OTLP JSON Broadcast payloads through a dedicated bearer-authenticated
Cloudflare endpoint, validates and redacts them, idempotently archives the
complete redacted payload, strips bodies, and forwards the correlated slim
trace to internal Tempo. Success is returned only after archive and forwarding.
Deploy it via CDK8s and ArgoCD with a required 1Password secret, restrictive
network policy, probes, and a public first-party GHCR image.

Expand dashboards, alerts, and recording rules for latency, tokens,
actual/catalog/upstream cost and discrepancy, resolved providers, router
fallbacks, structured-output retries/exhaustion, missing metadata, and
Broadcast/archive health. Preserve old series across the cutover.

## Architecture enforcement

Add a CI check prohibiting active Mastra and VoltAgent imports, direct provider
SDKs and base URLs, ordinary provider API-key variables, and Claude/Codex
subprocesses. Allow only native SDK dependencies and required peers, historical
documentation, and the external code-review provider.

## Deployment sequence

The repository change is atomic and contains no long-lived dual implementation.
During the deployment window:

1. Create one OpenRouter key per service and stage plus the Broadcast bearer
   secret.
2. Deploy and canary Broadcast ingest first.
3. Deploy all migrated consumers from the same commit.
4. Run live capability and telemetry acceptance.
5. Remove remaining direct-provider secret wiring and revoke obsolete keys only
   after acceptance succeeds.

## Remaining

- [x] Implement and verify the shared runtime, catalog enrichment, and
      architecture check.
- [x] Cut over every ordinary-inference consumer and remove active framework
      and direct-provider dependencies.
- [x] Replace active Claude/Codex subprocess integrations with native SDKs.
- [x] Ship PR Fleet v2 while preserving v1 replay and dashboard compatibility.
- [x] Ship Broadcast ingest, GitOps resources, telemetry dashboards, alerts,
      recording rules, archives, and operational documentation.
- [x] Run focused package validation and the exhaustive repository verification
      graph; only operator-secret provisioning and the unrelated local XeLaTeX
      dependency remain outside the source tree.
- [ ] Run fixed-corpus Scout and Pokemon comparisons.
- [ ] Perform live deployment acceptance for OpenRouter text, structured output,
      tools, embeddings, images, web search, Claude SDK, Codex SDK, all migrated
      consumers, and the deployed Temporal canary.

## Acceptance

Foundation contract tests cover text, streaming, tools, structured output,
embeddings, images, web search, metadata, cancellation, catalog schemas and
routes, retry accounting, additive router metadata, and prevention of
multiplicative retries. Consumer tests cover existing package behavior, Scout
tool/finalizer streaming, PR Fleet v1 and v2, native SDK progress/cancellation/
effect safety, Monarch search limits, Pokemon artifact compatibility, and
homelab synthesis/security/query behavior.

Live acceptance verifies, for one request of every transport and agent type,
the repository parent span, SDK child spans, gateway correlation, Loki logs,
Prometheus metrics, actual cost, router metadata, redacted S3 body archive, and
body-free Tempo trace. It then verifies the Temporal production canary and
tagged delivery, Scout beta report/eval materialization, Birmel Discord behavior,
PR Fleet replay/dashboard, Monarch classification, Pokemon goal execution, and
absence of ordinary direct-provider traffic before key revocation.

## Comment Log

- 2026-08-09: Approved for an atomic implementation. Ordinary inference is
  OpenRouter-only; OpenRouter may fall back between upstream providers but not
  between catalog models. Native Claude and Codex SDKs are reserved for
  general-purpose coding/computer-use agents.
- 2026-08-09: Source cutover, architecture enforcement, run-bundle v2,
  Broadcast ingest, GitOps, bounded metrics, dashboard, alerts, and operational
  documentation implemented. Fixed-corpus comparison and live deployment
  acceptance remain operator gates; obsolete credentials are not revoked until
  those gates pass.
- 2026-08-09: Restacked onto current `main` while preserving the PostHog and
  alert-dashboard cutovers. Review-driven fixes added strict tool serialization,
  complete failed-attempt usage and router accounting, bounded transport retry
  tests, and authoritative raw-response capture. Focused validation passed 64
  of 64 tasks; exhaustive verification passed 243 of 246 tasks. The remaining
  failures are missing migration fields in the operator's 1Password vault and
  the local XeLaTeX executable, not source failures.
- 2026-08-09: Final architecture and observability review added repository-owned
  AI SDK parent spans, context propagation through Claude and Codex SDK streams,
  safe correlated OpenRouter logs, raw-response token and cost accounting,
  aggregate catalog cost, endpoint-correct router-metadata metrics, ScoutQL
  semantic finalization, and removal of the Pokemon Codex binary seam. The
  4,499-file architecture guard, all focused consumer suites, formatting, and
  Knip pass. Exhaustive verification now passes 244 of 246 tasks; only the seven
  unprovisioned 1Password values and this machine's missing XeLaTeX executable
  remain.
