---
title: LLM stack
description: One ordinary-inference gateway, two native coding-agent exceptions, repository-owned model and eval contracts, and an observability boundary that keeps bodies out of Tempo.
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
labels. OpenRouter, Claude Agent SDK, and Codex SDK share:

- `llm_requests_total`
- `llm_request_duration_seconds`
- `llm_tokens_total`
- `llm_cost_usd_total`

Structured-output attempts, router attempts, and missing router metadata have
separate counters. Existing `ai_provider_errors_total` and
`ai_provider_issue_active` series remain queryable across the cutover.

## Deployment acceptance

The migration is deployed atomically. Create one OpenRouter key per service and
stage, create the Broadcast bearer secret, publish the Broadcast image, and
canary Broadcast before the consumers. For each transport, verify the
application span, SDK child spans, correlated Broadcast span, Loki log,
Prometheus usage and cost, private body archive, and body-free Tempo record.
Only after text, structured output, tools, embeddings, images, web search,
Claude SDK, Codex SDK, and the production Temporal canary pass may old provider
secrets be revoked.

Repository configuration or a healthy pod is not production acceptance. The
operator must observe the real archive, Tempo, metrics, logs, and consumer
behavior.
