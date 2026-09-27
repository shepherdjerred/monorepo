---
title: Attribute LLM spend to a user
description: Join Loki's per-call cost records to the Tempo spans that name the subject, to find what one person or one tracked player cost.
sidebar:
  order: 16
---

Per-feature spend is a single Prometheus query. Per-_subject_ spend is not: subject
IDs are span attributes rather than metric labels, so the dollars live in Loki and
the identity lives in Tempo, joined on `traceId`.

This guide answers "what did this user cost". It works over the last 30 days, the
Tempo retention limit.

## 1. Find spend for the feature you care about

```bash
toolkit prom query 'topk(10, sum by (service, workload) (increase(llm_cost_usd_total{type="catalog"}[24h])))'
```

This is the live series: the catalog price applied to provider-reported tokens.
It counts OpenAI complimentary data-sharing tokens as if they were paid, so it is
an upper bound on what OpenAI charged. For what the providers actually bill, see
[Compare live and billed spend](#compare-live-and-billed-spend) below.

Sum before anything else. These series carry `pod`, so a deploy inside the window
leaves two counter series per workload, and the sum collapses both lifetimes.

## 2. Pull the per-call cost records with their trace IDs

Each successful call logs one JSON record carrying `workload`, `provider`,
`model`, `responseId`, `serviceTier`, token counts, `catalogCostUsd`, and
`traceId`.

```bash
toolkit loki query '{namespace="scout-beta"} |= "llm.provider.response"' --since 24h --limit 200
```

Namespaces are `scout-beta`, `birmel`, and `temporal`. A record whose `traceId` is
null was made outside an active attribution span and cannot be attributed — that is
a bug in the call site, not a gap in this procedure.

## 3. Resolve each trace to its subject

```bash
toolkit tempo get <traceId> --jq '.trace.resourceSpans[].scopeSpans[].spans[]
  | {name, a: [.attributes[]? | select(.key|test("llm.subject")) | {(.key): (.value|to_entries[0].value)}]}
  | select(.a|length>0)'
```

Sum the cost records sharing a trace ID to get that subject's total for the
interaction. A trace is one interaction, so every workload inside it — routing,
embedding, the answer itself — belongs to the same subject.

Filter on `gen_ai.operation.name` when you want one row per model call. The
subject is stamped onto every `gen_ai.*` span as well as the attribution span
above them, so matching without that filter counts the interaction twice.

## Alternative: recent activity, without the join

For "who is active right now" rather than exact dollars, query Tempo directly:

```bash
toolkit tempo metrics '{span.gen_ai.operation.name != "" && span.llm.subject.id != ""} | count_over_time() by (span.llm.subject.kind)' --since 3h
```

Tempo caps metrics queries at a three-hour range, so this cannot replace the join
for anything longer. The AI Provider dashboard's Attribution row runs the same
queries.

## If a call has no subject

Workloads with no requester declare `system` on purpose — scheduled betting runs
and match reviews are not made on behalf of a person who asked. Those are
attributed, just not to a human. A span with _no_ subject attributes at all is an
unwrapped call site.

## Compare live and billed spend

The `llm-billed-cost-hourly` Temporal schedule reads OpenAI's organization
Costs and Usage APIs and Anthropic's Cost Report, per project and workspace:

```bash
toolkit prom query 'sum by (provider, account, window) (llm_billed_cost_usd)'
toolkit prom query 'sum by (account, model, service_tier, type) (llm_billed_tokens{provider="openai"})'
toolkit prom query 'time() - max by (provider) (llm_billed_reconciliation_last_success_timestamp_seconds)'
```

`window="today"` is the current UTC day; `window="7d"` is the seven UTC days
ending today. Compare the seven-day billed figure with
`sum by (provider) (increase(llm_cost_usd_total{type="catalog"}[7d]))`:

- **Billed below live** is expected for OpenAI projects with data sharing
  enabled. Complimentary tokens appear in `llm_billed_tokens` under a
  non-`default` service tier with no matching cost.
- **Billed above live** means traffic the runtime does not price — Codex,
  voice, transcription — or a catalog price that has drifted. Check which
  account moved before editing the catalog.
- **Google** has no billed series. Its per-project spend is visible only in AI
  Studio and through Cloud Billing budget alerts.

The alerts divide by source: `LlmDailySpendHigh`/`Critical` fire on the live
series, `LlmBilledSpendHigh`/`Critical` on billed spend for the current UTC day,
and `LlmBilledReconciliationStale` when no reconciliation has succeeded for two
hours after the billing worker started. Each project and workspace also has a
provider-side hard cap that rejects requests once reached.

To rotate the billing worker's admin keys, create a new OpenAI organization
admin key and Anthropic admin key, replace `OPENAI_ADMIN_KEY` and
`ANTHROPIC_ADMIN_API_KEY` in the dedicated `temporal-openai-usage-monitor`
1Password item, restart `temporal-billing-worker`, and trigger the schedule
once. Delete the prior keys only after
`llm_billed_reconciliation_last_success_timestamp_seconds` advances for both
providers. Never move these keys into the shared Temporal item: admin keys are
organization-wide credentials.

For the worker rollout procedure, use the
[Temporal worker deployment rollout guide](/how-to/roll-out-a-temporal-worker-deployment/).

## Related

- [LLM stack](/explanation/llm-stack/) — why subject IDs stay out of Prometheus,
  and why the 30-day horizon exists.
- [Rotate LLM provider credentials](/how-to/rotate-provider-credentials/) — the
  per-workload keys, federation, and provider spend caps.
