---
title: Run the agent task canary
description: Verify the deployed Claude structured-output contract against the real production queue after a worker image rollout.
sidebar:
  order: 4
---

Run this after the worker image is live. It exercises the real `agent-task`
queue, the deployed OAuth authentication, the real parser, and a tagged
report-only email.

A local dry run is not equivalent and does not satisfy the production check.

## 1. Run it

```bash
cd packages/temporal
TEMPORAL_ADDRESS=<private-temporal-host>:443 TEMPORAL_TLS=true \
  bun run canary:agent-task
```

Replace `<private-temporal-host>` with the operator-reachable TLS endpoint from
private configuration. The hostname is deliberately not published in this
public wiki.

## 2. Wait for the email

The tagged report-only email must actually arrive. That is the pass condition —
a workflow that completes without the email is not a pass.

## 3. Check the contract held

Claude's output is a versioned provider contract. The worker sends a draft-07
plain-optional schema inline and accepts only the CLI result message's
`structured_output` field.

A successful process that returns no `structured_output` is a failure. Prose and
fenced JSON are not fallback formats.

On a contract failure, the logs and traces carry a bounded redacted final-text
excerpt, the result subtype and keys, and the schema fingerprint. The Prometheus
counter uses bounded reason labels only, so read the logs for the specific
cause.

## If it fails

| Symptom                               | Look at                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No workflow started                   | Temporal address, TLS flag, OAuth token                                                                 |
| Workflow failed with a contract error | the schema fingerprint in logs; the pinned Claude Code version                                          |
| Workflow succeeded, no email          | Postal delivery, not the agent contract                                                                 |
| Timeout with no activity              | worker or task-queue availability — see [pause or debug a schedule](/how-to/pause-or-debug-a-schedule/) |

## Related

- [Agent task input](/reference/agent-task-input/) — provider settings and the pinned version
- [Schedule an agent task](/how-to/schedule-an-agent-task/)
