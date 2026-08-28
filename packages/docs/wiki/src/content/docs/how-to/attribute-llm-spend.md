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
toolkit prom query 'topk(10, sum by (service, workload) (max by (service, workload, model) (increase(llm_cost_usd_total{type=~"actual|upstream"}[24h]))))'
```

Take the per-series maximum of `actual` and `upstream`, not `actual` alone: a BYOK
route bills nothing through OpenRouter and reads as `$0` under an actual-only query
while still costing real money upstream.

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
embedding, the answer itself — belongs to the same subject even though only the
top-level span carries the subject attributes.

## Alternative: recent activity, without the join

For "who is active right now" rather than exact dollars, query Tempo directly:

```bash
toolkit tempo metrics '{span.llm.subject.id != ""} | count_over_time() by (span.llm.subject.kind)' --since 3h
```

Tempo caps metrics queries at a three-hour range, so this cannot replace the join
for anything longer. The AI Provider dashboard's Attribution row runs the same
queries.

## If a call has no subject

Workloads with no requester declare `system` on purpose — scheduled betting runs
and match reviews are not made on behalf of a person who asked. Those are
attributed, just not to a human. A span with _no_ subject attributes at all is an
unwrapped call site.

## Related

- [LLM stack](/explanation/llm-stack/) — why subject IDs stay out of Prometheus,
  and why the 30-day horizon exists.
- [Enable OpenRouter Broadcast](/how-to/enable-openrouter-broadcast/) — the
  correlated per-generation record from OpenRouter itself.
