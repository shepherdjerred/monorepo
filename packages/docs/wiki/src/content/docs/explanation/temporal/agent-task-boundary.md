---
title: Report-only by policy, not by sandbox
description: What actually stops a scheduled agent from changing things, and why the honest answer is uncomfortable.
sidebar:
  order: 2
---

Agent tasks are scheduled Claude or Codex runs that inspect current state and
email a report. They are **report-only by policy, not by sandbox**.

That distinction is the whole content of this page, and it is worth being blunt
about because the comfortable version would be misleading.

```mermaid
flowchart TD
  accTitle: Agent task lifecycle
  accDescr: A doc block via the operator CLI, or the authenticated HTTP API, submits a task to one dispatcher, which either upserts a cron schedule or starts a one-off workflow. The workflow runs the agent read-only over a repo clone, emails the report, and may dispatch one follow-up.

  B[Doc block] --> CLI[Operator CLI]
  CLI --> DIS[Dispatcher]
  API[HTTP API] --> DIS
  DIS -->|cron| SCH[Temporal schedule]
  DIS -->|runAt| WF[Workflow run]
  SCH --> WF
  WF --> R[Agent runs read-only<br>over a repo clone]
  R --> E[Email report]
  E -.-> F[Optional follow-up task]
```

## What actually constrains the run

The run gets `Bash` and a write-capable GitHub token. What keeps it from
mutating the repo is:

- a hard read-only prompt prefix,
- an ephemeral non-root pod,
- a throwaway per-run clone.

What does **not** constrain it is a schema that makes mutation unrepresentable,
or a filesystem that refuses writes. Codex runs with
`--sandbox danger-full-access`, because the worker pod cannot provide the
namespace Codex's own sandbox needs.

So the barrier is policy. A sufficiently confused or prompt-injected run could
write.

## Why it is built this way anyway

The flagship consumer is the daily homelab audit, and it needs credentials to do
its job. Checking cluster, DNS, backup, and alert state means actually querying
those systems. So Grafana, PagerDuty, ArgoCD, Bugsink, Cloudflare, Postal, and
the mounted service-account token are all readable.

An agent scoped tightly enough to be provably harmless would also be scoped too
tightly to audit anything.

The GitHub App key is stripped and replaced with a fresh installation token, and
for Claude the Anthropic API key is dropped so the run bills the subscription.
But the rest of the worker environment is inherited.

## The blast radius, stated plainly

A deviating or prompt-injected run's blast radius is those credentials.

The containment is that the pod is ephemeral and non-root, the clone is
throwaway, and the run cannot persist anything beyond its report. It is real
containment, and it is not a sandbox.

Anything that genuinely must change the repo is a
[deterministic scheduled workflow](/reference/temporal-schedules/) instead —
code, reviewed in a PR, not an agent asked nicely.

## Why the output contract is strict

Claude's output is treated as a versioned provider contract. The worker sends a
draft-07 schema inline and accepts **only** the CLI result message's
`structured_output` field, validated with Zod.

A successful process without that field is a failure. Prose and fenced JSON are
not fallback formats.

Accepting a fallback would mean a model that ignored the schema still appears to
succeed, and the report quietly degrades from structured findings to
free-writing. Failing loudly is the only way an unattended run can tell you its
contract broke.

Contract failures log a bounded redacted excerpt, the result subtype and keys,
and the schema fingerprint. The Prometheus counter uses bounded reason labels
only, so cardinality cannot explode from model output.

## Cost is traced even on failure

The LLM span, with token cost, is emitted before the exit-code check. A failed
run that spent tokens still shows up in observability.

With telemetry enabled, each run's prompt and response are recorded as `gen_ai.*`
spans whose bodies are archived to the LLM-observability store before the slim
span is exported. The email is the human-facing output, but it is not the only
copy.

## Related

- [Agent task input](/reference/agent-task-input/) — the full contract
- [Schedule an agent task](/how-to/schedule-an-agent-task/)
- [Why Temporal](/explanation/temporal/overview/)
