---
title: LLM stack
description: One OpenRouter gateway, one subscription-backed Codex exception, repository-owned model and eval contracts, and an observability boundary that keeps bodies out of Tempo.
sidebar:
  order: 5
---

Ordinary model inference in the monorepo goes through AI SDK 7 and the shared
`@shepherdjerred/llm-runtime` package to OpenRouter. Text, structured output,
tools, embeddings, images, and model-controlled web search all use that path.
Every route disables model fallback, so OpenRouter may select an upstream host
for the exact requested model but may not silently substitute another model.

The Codex SDK is the tool-using exception. A shared adapter routes release,
Temporal, and Birmel agents through OpenRouter while keeping stable catalog IDs
on telemetry. The Pokémon goal agent remains on Sol with its existing Codex
subscription authentication because goal quality matters more than its
infrequent cost. Active `claude` and `codex` subprocess integrations are
forbidden. Subscription authentication is forbidden outside that exact
Pokémon path. Temporal retains a Claude input decoder only so existing workflow
histories can replay; a legacy Claude task cannot start fresh inference.

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
AI SDK and native SDK spans. Complete redacted prompt, response, and tool bodies
go to the private SeaweedFS LLM archive. Tempo receives only body-free spans and
archive references.

OpenRouter Broadcast is a correlated second source of routing, provider, token,
and actual-cost evidence. The authenticated `openrouter-broadcast-ingest`
service archives the complete redacted OTLP JSON payload, strips bodies, and
forwards the slim trace to Tempo. Its digest receipt makes webhook redelivery
idempotent, including retries across UTC date partitions. A `204` means both
archive and forward completed; a failure intentionally asks OpenRouter to
redeliver.

Prometheus uses bounded service, workload, provider, model, outcome, token-type,
and cost-type labels. Trace, generation, session, and user IDs are never
labels. OpenRouter AI SDK, OpenRouter-backed Codex SDK, and the Pokémon native
Codex path share:

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
separate counters. Existing `ai_provider_errors_total` and
`ai_provider_issue_active` series remain queryable across the cutover.

## Deployment acceptance

Create one capped OpenRouter key per migrated service and stage. Preserve the
Pokémon subscription credential separately. Canary Broadcast before the
OpenRouter consumers, then canary the Pokémon Sol agent through its native
subscription path. For each transport, verify the application span, SDK child
spans, Loki log, Prometheus usage and cost, private body archive, and body-free
Tempo record. OpenRouter calls also require a correlated Broadcast span. Old
subscription credentials may be revoked only after every migrated Codex path
passes; the Pokémon credential remains active.

Repository configuration or a healthy pod is not production acceptance. The
operator must observe the real archive, Tempo, metrics, logs, and consumer
behavior.
