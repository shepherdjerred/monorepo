---
title: LLM stack
description: One shared runtime that calls OpenAI, Anthropic, and Google directly, two native coding-agent exceptions, per-workload credentials with provider-side spend caps, and an observability boundary that puts full content on every span and tail-samples LLM traces into a self-hosted Phoenix.
sidebar:
  order: 5
---

Ordinary model inference in the monorepo goes through AI SDK 7 and the shared
`@shepherdjerred/llm-runtime` package, which calls OpenAI, Anthropic, and
Google directly. Text, structured output, tools, embeddings, images, and
model-controlled web search all use that path. Each catalog model names exactly
one first-party provider route, so there is no upstream failover: a provider
outage fails the call rather than silently serving a different model.

The runtime used to front everything with OpenRouter. That bought one key and
one bill, but it hid which provider served a call, put a reseller between the
repository and each provider's own spend controls, and made every cost figure a
number someone else computed. Calling providers directly moves spend
containment to where the money is charged — each provider's own project or
workspace caps — and makes cost exact arithmetic on provider-reported tokens.

Claude Agent SDK and Codex SDK are the two exceptions. They are reserved for
general-purpose coding or computer-use agents where a model needs repository
and command tools. They run in process through their native SDKs; active
`claude` and `codex` subprocess integrations are forbidden.

## Repository-owned contracts

- `@shepherdjerred/llm-models` remains the language-neutral source of stable
  model IDs, capabilities, routes, lifecycle state, and canonical pricing.
- `@shepherdjerred/llm-runtime` resolves each model's native route, constructs
  the provider client, adds application and trace attribution, enables AI SDK
  telemetry, and accounts usage and catalog cost. It is the only place a
  provider SDK is constructed or a provider credential is read.
- `generateValidatedObject` is the only shared higher-level primitive. It uses
  a strict Zod-backed object output, retries transport failures separately from
  bounded semantic repair, and never extracts JSON from prose.
- Scout and Discord Plays Pokemon keep their existing project-specific eval
  corpora and comparison processes. There is no generic eval framework.
- A CI architecture check rejects Mastra, VoltAgent, any OpenRouter surface,
  provider SDKs and endpoints outside the runtime, provider credentials outside
  reviewed wiring paths, a deployed `ANTHROPIC_API_KEY`, and agent CLI
  subprocesses.

## Credentials and spend containment

Every workload and environment gets its own credential and its own provider
project or workspace, so one runaway feature exhausts its own cap and nothing
else. The three providers allow three different authentication models:

| Provider  | Production credential                       | Hard cap                              | Managed by                                          |
| --------- | ------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| OpenAI    | Per-project service-account key             | Project spend limit, model allowlist  | OpenTofu (`openai`), CI-applied                     |
| Anthropic | Workload identity federation, no stored key | Workspace spend limit (Console)       | OpenTofu (`anthropic-federation`), operator-applied |
| Google    | Service-account-bound Gemini API key        | AI Studio project spend cap (Console) | OpenTofu (`google`), operator-applied               |

OpenAI has no federation, so production holds a static key there; OpenTofu
mints it and an operator hands it to 1Password. The operator-applied Google
and Anthropic stacks write their outputs into dedicated 1Password items
themselves, so applying them needs no handoff or follow-up commit. Anthropic federates: a pod presents a
projected Kubernetes service-account token, and the runtime exchanges it for a
short-lived access token. Federated workloads hold no Anthropic secret at all.
The runtime refuses to start a federated client when `ANTHROPIC_API_KEY` is
also set, because that key would silently outrank federation — the one way this
design could appear to work while not actually being federated.

Google was first planned on Vertex AI with federation, but Vertex has no
per-project spend cap; its only hard limits are request quotas, and a dollar cap
needs an enterprise subscription. The Gemini API has a per-project spend cap, at
the cost of a static key, which OpenTofu mints and binds to a per-workload
service account. A capped static key beat an uncapped federated identity.

CI and local development cannot federate, so they use static keys from
1Password for every provider. Provider-side caps are the backstop; the Prometheus
alerts below are the early warning. Rotation and the manual steps are in
[Rotate LLM provider credentials](/how-to/rotate-provider-credentials/).

## Observability boundary

Local OpenTelemetry is authoritative. Repository-owned `gen_ai.*` spans wrap
AI SDK and native SDK spans. Spans carry the complete prompt, response, and
tool bodies. A copy of those bodies also goes to the private SeaweedFS LLM
archive, and each span carries its archive reference.

Content lives on the span because a trace without it cannot answer the
questions LLM traces exist for. Agent failures are semantic rather than
exceptional, so debugging one means reading the trajectory, and any downstream
eval or observability consumer needs the same content. An earlier design
stripped bodies from spans and kept them only in the archive; it made every
transcript read a two-store join and was reversed. The archive remains because
Tempo's retention is 30 days: it is the durable body record, not the only one.
Content is never redacted, including Discord data. Only credentials are
masked before export — secret-shaped keys, known secret env values, `Bearer`
tokens, and Discord webhook and invite URLs — by
[`redact.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/llm-observability/src/redact.ts),
so they stay out of every store.

Traces enter storage through `alloy-gateway`, an unprivileged Grafana Alloy
Deployment that receives OTLP/HTTP. It forwards every span to Tempo
unconditionally and tail-samples LLM traces into Phoenix. The gateway
exists so that adding a trace consumer is gateway configuration rather than a
credential and an exporter in every service; Phoenix is that consumer. It
is deliberately a second Alloy release: the existing `alloy` app is a
privileged, hostPID eBPF profiler whose security boundary is having no ingress
at all, and a trace gateway needs the opposite shape. The gateway carries no
Kubernetes RBAC and mounts no service-account token: a network-facing pod that
never calls the Kubernetes API gets nothing to escalate with.

[Arize Phoenix](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/phoenix/index.ts)
is the trace, eval, and dataset consumer of those spans. It runs in the
cluster on its own Postgres. The hosted consumer it replaced metered ingest,
and the sampled LLM traffic outgrew its free allowance within weeks. Phoenix
converts `gen_ai.*` attributes to its own conventions on ingest, so producers
need no Phoenix-specific instrumentation. Messages in the semantic-convention
`parts` shape, which AI SDK emits, render as chat turns. Other message shapes
stay readable as raw span attributes.

The gateway keeps whole traces that contain `gen_ai.*` spans, deciding after a
two-minute wait. Whole traces keep the root span, so a trace reads as one
trajectory rather than orphaned LLM calls. Kept traces route to
per-service-stage projects — `scout-beta`, `scout-prod`, `birmel`,
`temporal`, `discord-plays`, `misc` — through explicit allowlist branches.
Each branch sets the `x-project-name` header and shares one system API key. A
service listed in no branch reaches no project. That exclusion bounds
Phoenix's database growth, so there is deliberately no catch-all branch.
Phoenix keeps traces
for 30 days, matching Tempo, and blocks inserts before its volume fills. The
kill switch for a runaway producer is removing a branch from the sampler's
output list, which the config reloader applies without recreating the pod;
see [Route a service to Phoenix](/how-to/route-a-service-to-phoenix/). The
sampler's decision cache forwards late spans of already-kept traces, but
spans that completed more than the decision window before a trace's first
LLM span are gone for Phoenix. That loss is bounded to the pre-LLM bootstrap
of long agent traces and is accepted; Tempo always holds the complete trace.

Prometheus uses bounded service, workload, provider, model, outcome, token-type,
and cost-type labels. Trace, generation, session, and user IDs are never
labels. The direct providers, Claude Agent SDK, and Codex SDK share:

- `llm_requests_total`
- `llm_request_duration_seconds`
- `llm_tokens_total`

The `provider` label now names the real provider, and `gen_ai.system` on spans
is the real provider too, which makes the traces conform to the GenAI semantic
conventions for the first time.

`llm_cost_usd_total` is **not** shared. Both native SDKs bill against a
subscription rather than per call, so any figure they report is an
API-equivalent price rather than money that moved. They record tokens instead.

Providers return tokens, never dollars, so spend has two series that measure the
same money from opposite directions:

- **Live** — `llm_cost_usd_total{type="catalog"}`: the catalog price applied to
  provider-reported usage, per request, including cache reads and writes,
  service tier, and server-side tool calls. It moves within a scrape and carries
  workload labels, but it cannot see uninstrumented traffic (Codex, voice) or
  OpenAI's complimentary data-sharing tokens.
- **Billed** — `llm_billed_cost_usd{provider,account,window}`: what OpenAI's
  Costs API and Anthropic's Cost Report say they will charge, per project or
  workspace, reconciled hourly by the `temporal-billing-worker`. It includes
  everything and is net of complimentary tokens, but it is an hour late and has
  no workload labels.

OpenAI's data-sharing program makes the two disagree on purpose: free tokens
count in the live series and are absent from the billed one, so billed sitting
below live is the program working. Billed above live means uninstrumented
traffic or a stale catalog price. The dashboard shows both side by side rather
than alerting on the gap, because the uninstrumented share makes any fixed
tolerance meaningless. Both series have their own daily ceilings, and a
staleness alert fires when the reconciliation stops succeeding. Google has no
spend API short of a Cloud Billing export to BigQuery, so it has no billed
series yet; its caps and Cloud Billing budget alerts cover it.

The billing worker is a single-purpose Activity Worker: it holds the OpenAI and
Anthropic organization admin keys and has Temporal, telemetry, and HTTPS egress,
but no Flipt reachability or Kubernetes service-account token. The admin keys
remain organization-wide at each provider despite that runtime isolation.

## Attribution

Spans carry who a call was made on behalf of, as a `(kind, id)` pair over
`discord_user`, `guild`, `tracked_player`, and `system`. A bare user ID would
not have fitted: match reviews are generated for a tracked player nobody asked
on behalf of, and the betting workloads run on a schedule across players tracked
in different servers, so they belong to no single guild. Those workloads declare
`system` rather than borrowing an arbitrary user, which keeps unattributed spend
visible as unattributed rather than misfiled.

The attribution span must be _active_, not merely created. The runtime reads the
ambient span when it stamps a call's trace ID, so a call made outside one reaches
the provider with no trace ID, and its cost log can never be joined back to the
span naming the subject. This is why Scout's cost logs carried a null
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

Structured-output attempts have their own counter. Billed cost, billed OpenAI
tokens by service tier, and reconciliation freshness are gauges.
Project IDs, generation IDs, user IDs, prompts, and responses never become
labels. Existing `ai_provider_errors_total` and
`ai_provider_issue_active` series remain queryable across the cutover.

## Deployment acceptance

The cutover to direct providers is atomic. Before it deploys, the operator
hands each workload's OpenAI key to 1Password and applies the operator-only
`google` and `anthropic-federation` stacks, which write the Gemini keys and
federation identifiers to 1Password themselves. Pods reference those items, so
a workload whose stack has not been applied waits on its missing Secret. For each
provider and endpoint type, verify the application span, provider child spans,
Loki log, live cost, body archive, and full-content Tempo record; for
Anthropic, also confirm the exchange appears in the Console's workload-identity
history across several token rotations. Only after that, and after the old
OpenRouter dashboard shows no traffic for a day, may the OpenRouter keys be
revoked.

Repository configuration or a healthy pod is not production acceptance. The
operator must observe the real archive, Tempo, metrics, logs, and consumer
behavior.
