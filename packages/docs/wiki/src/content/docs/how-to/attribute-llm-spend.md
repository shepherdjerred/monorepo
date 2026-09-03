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
toolkit prom query 'topk(10, sum by (service, workload) (max by (service, workload, model) (sum by (service, workload, model, type) (increase(llm_cost_usd_total{type=~"actual|upstream"}[24h])))))'
```

Take the per-series maximum of `actual` and `upstream`, not `actual` alone: a BYOK
route bills nothing through OpenRouter and reads as `$0` under an actual-only query
while still costing real money upstream.

For OpenAI complimentary-token traffic, this is intentionally conservative and
does not answer what was paid. Use the official reconciliation below before
treating `upstream` as an OpenAI charge.

The inner `sum` must stay inside the `max`. These series carry `pod`, so a deploy
inside the window leaves two counter series per workload, and taking the maximum
first would keep only the longer-lived pod's spend.

## 2. Pull the per-call cost records with their trace IDs

Each successful call logs one JSON record carrying `workload`, `model`,
`generationId`, `traceId`, and all three cost figures.

```bash
toolkit loki query '{namespace="scout-beta"} |= "llm.openrouter.response"' --since 24h --limit 200
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

## Verify Scout's complimentary OpenAI inference

First confirm that successful Scout reviews used the configured provider key:

```bash
toolkit prom query 'sum by (model, upstream_provider, byok) (increase(llm_openrouter_byok_requests_total{exported_service="scout-for-lol-backend",workload=~"scout[.]review([.]text)?"}[1h]))'
```

`byok="true"` is necessary but not sufficient. Trigger the
`openai-complimentary-usage-hourly` Temporal schedule after waiting at least 15
minutes from the request, then query the official provider reconciliation:

```bash
toolkit prom query 'sum by (model, service_tier, type) (openai_project_usage_tokens)'
toolkit prom query 'max(openai_project_cost_usd)'
toolkit prom query 'time() - max(openai_usage_reconciliation_last_success_timestamp_seconds)'
```

The request is confirmed complimentary only when its tokens appear under
`incentivized-tier` and official current-day Costs remain zero. A request that
crosses OpenAI's daily allowance can be billed in full, so any `default`-tier
tokens are actionable even when BYOK is still healthy.

The alerts divide failures by evidence layer:

For the full worker rollout, schedule, and alert acceptance procedure, use the
[Temporal worker deployment rollout guide](/how-to/roll-out-a-temporal-worker-deployment/).

- `ScoutOpenAiNotByok` means OpenRouter reported shared capacity for a
  successful Scout review.
- `LlmOpenRouterMetadataMissing` means the request-level credential evidence is
  absent.
- `OpenAiComplimentaryPaidTokens` means the official Usage API reported
  `default`-tier tokens.
- `OpenAiOpenRouterProjectCost` means official current-day Costs reached one
  cent.
- `OpenAiComplimentaryMonitorStale` means no complete reconciliation succeeded
  for two hours after the billing worker started.

To rotate the monitor credential, create a new organization admin key named
`openai-usage-monitor`, replace only the `OPENAI_ADMIN_KEY` field in the
dedicated 1Password item, restart `temporal-billing-worker`, and run the
schedule once. Delete the prior OpenAI admin key only after Usage, Costs,
metrics, and both Alertmanager resolutions succeed. Never move this key into
the shared Temporal item: OpenAI admin keys are organization-wide credentials.

## Related

- [LLM stack](/explanation/llm-stack/) — why subject IDs stay out of Prometheus,
  and why the 30-day horizon exists.
- [Enable OpenRouter Broadcast](/how-to/enable-openrouter-broadcast/) — the
  correlated per-generation record from OpenRouter itself.
