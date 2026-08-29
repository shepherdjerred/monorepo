---
title: Run the agent task canary
description: Verify the deployed Codex and OpenRouter structured-output contract against the real production queue after a worker image rollout.
sidebar:
  order: 4
---

Run this after the worker image is live. It exercises the real `agent-task`
queue, the deployed OpenRouter authentication, the real parser, and a tagged
contract-v2 report with a captured command receipt.

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

Then run the full report-path canary:

```bash
TEMPORAL_ADDRESS=<private-temporal-host>:443 TEMPORAL_TLS=true \
  bun run canary:report-reliability
```

It creates tagged v2 success, partial, and intentional-failure runs. Confirm
all three emails, their matching Temporal states, the typed S3 report state and
acceptance receipts, and delivery/freshness metrics. The failure workflow must
send `[FAILED]` before Temporal records the failure.

## 3. Check the contract held

Codex output is a versioned provider contract. The worker sends the v2 output
schema through the OpenRouter-backed Codex SDK and accepts only its structured
result.

A successful process that returns no `structured_output` is a failure. Prose and
fenced JSON are not fallback formats.

On a contract failure, the logs and traces carry a bounded redacted final-text
excerpt and the schema fingerprint. The Prometheus counter uses bounded reason
labels only, so read the logs for the specific cause.

## If it fails

| Symptom                               | Look at                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No workflow started                   | Temporal address, TLS flag, OAuth token                                                                 |
| Workflow failed with a contract error | the schema fingerprint in logs; the pinned Codex SDK contract                                           |
| Workflow succeeded, no email          | shared report delivery and S3 acceptance state                                                          |
| Partial canary reports clean          | evidence normalization and required-check coverage                                                      |
| Failure canary has no email           | failure-report-before-rethrow path                                                                      |
| Timeout with no activity              | worker or task-queue availability — see [pause or debug a schedule](/how-to/pause-or-debug-a-schedule/) |

## Related

- [Agent task input](/reference/agent-task-input/) — provider settings and the pinned version
- [Schedule an agent task](/how-to/schedule-an-agent-task/)
