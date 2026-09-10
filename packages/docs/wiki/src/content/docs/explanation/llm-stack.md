---
title: LLM stack
description: One ordinary-inference gateway, two native coding-agent exceptions, repository-owned model and eval contracts, and an observability boundary that puts full redacted content on every span and tail-samples LLM traces into Braintrust.
sidebar:
  order: 5
---

Ordinary model inference in the monorepo goes through AI SDK 7 and the shared
`@shepherdjerred/llm-runtime` package to OpenRouter. Text, structured output,
tools, embeddings, images, and model-controlled web search all use that path.
OpenRouter may change the upstream provider for availability, but it may not
silently change the requested catalog model.

Claude Agent SDK and Codex SDK are the two exceptions. They are reserved for
general-purpose coding or computer-use agents where a model needs repository
and command tools. They run in process through their native SDKs; active
`claude` and `codex` subprocess integrations are forbidden.

## Repository-owned contracts

- `@shepherdjerred/llm-models` remains the language-neutral source of stable
  model IDs, capabilities, routes, lifecycle state, and canonical pricing.
- `@shepherdjerred/llm-runtime` resolves exact routes, adds application and
  trace attribution, enables AI SDK telemetry, captures router metadata, and
  accounts usage and cost.
- `generateValidatedObject` is the only shared higher-level primitive. It uses
  a strict Zod-backed object output, retries transport failures separately from
  bounded semantic repair, and never extracts JSON from prose.
- Scout and Discord Plays Pokemon keep their existing project-specific eval
  corpora and comparison processes. There is no generic eval framework.
- A CI architecture check rejects Mastra, VoltAgent, ordinary direct-provider
  clients and credentials, provider base URLs, and agent CLI subprocesses.

## Observability boundary

Local OpenTelemetry is authoritative. Repository-owned `gen_ai.*` spans wrap
AI SDK and native SDK spans. Spans carry the complete redacted prompt,
response, and tool bodies. A copy of those bodies also goes to the private
SeaweedFS LLM archive, and each span carries its archive reference.

Content lives on the span because a trace without it cannot answer the
questions LLM traces exist for. Agent failures are semantic rather than
exceptional, so debugging one means reading the trajectory, and any downstream
eval or observability consumer needs the same content. An earlier design
stripped bodies from spans and kept them only in the archive; it made every
transcript read a two-store join and was reversed. The archive remains because
Tempo's retention is 30 days: it is the durable body record, not the only one.
Redaction happens before export, so credentials stay out of both stores.

Traces enter storage through `alloy-gateway`, an unprivileged Grafana Alloy
Deployment that receives OTLP/HTTP. It forwards every span to Tempo
unconditionally and tail-samples LLM traces into Braintrust. The gateway
exists so that adding a trace consumer is gateway configuration rather than a
credential and an exporter in every service; Braintrust is that consumer. It
is deliberately a second Alloy release: the existing `alloy` app is a
privileged, hostPID eBPF profiler whose security boundary is having no ingress
at all, and a trace gateway needs the opposite shape. The gateway carries no
Kubernetes RBAC and mounts no service-account token: a network-facing pod that
never calls the Kubernetes API gets nothing to escalate with.

Braintrust is the hosted eval and observability consumer of those spans. The
gateway keeps whole traces that contain `gen_ai.*` spans, deciding after a
two-minute wait, because Braintrust renders a trace only around its root span.
Sampling fragments would have produced orphaned children there. Kept traces
route to per-service-stage projects — `scout-beta`, `scout-prod`, `birmel`,
`temporal`, `discord-plays`, `misc` — through explicit allowlist branches
sharing one org-wide API key. A service listed in no branch reaches no
project. That exclusion is the byte-budget control for Braintrust's metered
ingest, so there is deliberately no catch-all branch; OpenRouter Broadcast
payloads in particular stay out. The kill switch for a runaway budget is
removing a branch from the sampler's output list, which the config reloader
applies without recreating the pod. The sampler's decision cache forwards
late spans of already-kept traces, but spans that completed more than the
decision window before a trace's first LLM span are gone for Braintrust.
That loss is bounded to the pre-LLM bootstrap of long agent traces and is
accepted; Tempo always holds the complete trace.

OpenRouter Broadcast is a correlated second source of routing, provider, token,
and actual-cost evidence. The authenticated `openrouter-broadcast-ingest`
service archives the complete redacted OTLP JSON payload and forwards that
same redacted payload to Tempo. Its digest receipt makes webhook redelivery
idempotent, including retries across UTC date partitions. A `204` means both
archive and forward completed; a failure intentionally asks OpenRouter to
redeliver.

Prometheus uses bounded service, workload, provider, model, outcome, token-type,
and cost-type labels. Trace, generation, session, and user IDs are never
labels. OpenRouter, Claude Agent SDK, and Codex SDK share:

- `llm_requests_total`
- `llm_request_duration_seconds`
- `llm_tokens_total`

`llm_cost_usd_total` is **not** shared. Only the OpenRouter gateway contributes
to it. Both native SDKs bill against a subscription rather than per call, so any
figure they report is an API-equivalent price rather than money that moved.
Publishing that into the same series as real OpenRouter charges would have made
the one number people sum, and the ceilings that alert on it, wrong. The native
SDKs record tokens instead. Codex never had an `actual` figure at all, only a
catalog estimate, which made the series look complete while being a guess.

Cost is recorded under three `type` labels and they disagree, deliberately.
`actual` is what OpenRouter charged, `catalog` is what our own pricing table
predicts, and `upstream` is the provider's inference cost. For a BYOK route
OpenRouter charges nothing, so `actual` reads zero while the real money sits in
`upstream`. A spend query that reads only `actual` therefore understates the
fleet. Which of the three is authoritative in the general case is still an open
question, waiting on the correlated OpenRouter Broadcast record to settle it;
until then the spend ceilings take the per-series maximum of `actual` and
`upstream`, because an alert should err toward firing.

For OpenAI BYOK traffic, none of those three gateway figures proves what OpenAI
charged. Complimentary input/output sharing creates a fourth case: OpenRouter's
`actual` cost is zero, `upstream` is an estimate of ordinary provider cost, and
OpenAI may still charge zero because the request used its `incentivized-tier`.
The evidence therefore has a strict order:

1. `openrouter_metadata.is_byok` proves which credential path one request used.
2. OpenAI's organization Usage API proves which `service_tier` received its
   tokens after the provider's ingestion delay.
3. OpenAI's organization Costs API is the billing authority for money charged.
4. OpenRouter actual, upstream, and catalog cost remain routing and estimation
   diagnostics, not proof of an OpenAI payment.

The `temporal-billing-worker` reconciles the OpenRouter OpenAI project hourly,
with a 15-minute ingestion cutoff. It is a single-purpose Activity Worker: it
has one organization admin key, Temporal and telemetry access, HTTPS egress,
and Alertmanager access, but no Flipt reachability or Kubernetes service-account
token. The privileged admin key remains organization-wide at OpenAI despite
that runtime isolation.

## Attribution

Spans carry who a call was made on behalf of, as a `(kind, id)` pair over
`discord_user`, `guild`, `tracked_player`, and `system`. A bare user ID would
not have fitted: match reviews are generated for a tracked player nobody asked
on behalf of, and the betting workloads run on a schedule across players tracked
in different servers, so they belong to no single guild. Those workloads declare
`system` rather than borrowing an arbitrary user, which keeps unattributed spend
visible as unattributed rather than misfiled.

The attribution span must be _active_, not merely created. The runtime reads the
ambient span when it builds a call's attribution headers, so a call made outside
one reaches OpenRouter with no trace ID, and its cost log can never be joined
back to the span naming the subject. This is why Scout's cost logs carried a null
trace ID before the call sites were wrapped: its `gen_ai.chat` spans were trace
roots with no enclosing application span.

The subject then travels through OpenTelemetry context onto each `gen_ai.*`
span. Attributes are not inherited down a trace and usage is recorded on those
spans rather than on the attribution span above them, so without that hop a
query grouping by subject and summing tokens would be reading two different
spans and would find nothing.

Because subject IDs are unbounded they stay span attributes and never become
metric labels. That choice sets the horizon on every per-subject question:

| Store      | Retention | Answers                      |
| ---------- | --------- | ---------------------------- |
| Prometheus | 365 days  | per-feature cost             |
| Loki       | 90 days   | per-call cost, generation ID |
| Tempo      | 30 days   | per-subject attribution      |

Tempo is the binding constraint, and Tempo additionally caps a metrics query at
a three-hour range. Per-subject spend is therefore a recent-window question
answered by a join rather than a long-range aggregate; see
[Attribute LLM spend](/how-to/attribute-llm-spend/). A durable per-user ledger
would need its own store, which is deliberately not built until a chargeback or
quota requirement justifies it.

Structured-output attempts, router attempts, and missing router metadata have
separate counters. BYOK status is a bounded per-request counter; official
current-day OpenAI tokens, cost, and reconciliation freshness are gauges.
Project IDs, generation IDs, user IDs, prompts, and responses never become
labels. Existing `ai_provider_errors_total` and
`ai_provider_issue_active` series remain queryable across the cutover.

## Deployment acceptance

The migration is deployed atomically. Create one OpenRouter key per service and
stage, create the Broadcast bearer secret, publish the Broadcast image, and
canary Broadcast before the consumers. For each transport, verify the
application span, SDK child spans, correlated Broadcast span, Loki log,
Prometheus usage and cost, private body archive, and full-content Tempo
record.
Only after text, structured output, tools, embeddings, images, web search,
Claude SDK, Codex SDK, and the production Temporal canary pass may old provider
secrets be revoked.

Repository configuration or a healthy pod is not production acceptance. The
operator must observe the real archive, Tempo, metrics, logs, and consumer
behavior.
