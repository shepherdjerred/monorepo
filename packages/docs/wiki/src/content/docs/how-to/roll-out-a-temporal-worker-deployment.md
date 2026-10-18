---
title: Roll out a Temporal Worker Deployment
description: Canary, ramp, promote, or roll back central or Scout Workflow bundles while stable and candidate pollers remain available.
sidebar:
  order: 7
---

Use Delivery to change worker hosts and routing. The
[worker execution contract](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/README.md)
defines the retained hosts, rollout proofs, and independent recovery boundary.

## Release an environment

1. Inspect its retained hosts and the available immutable releases:

   ```bash
   toolkit deploy workers list ENVIRONMENT --json
   toolkit deploy versions SERVICE --json
   ```

   Use `temporal/prod`, `scout-for-lol/beta`, or `scout-for-lol/prod` as the
   environment. A host baseline proves existing pollers; it does not accept a
   new application release. Complete baseline verification before a rollout.

2. Request the selected version set, or inspect the automatic deployment:

   ```bash
   toolkit deploy start ENVIRONMENT VERSION --json
   toolkit deploy status DEPLOYMENT_ID --json
   ```

   Scout production requires human approval of the exact frozen release. Its
   backend, Workflow hosts, and frontend archive share one deployment and lock.

3. Follow the deployment through replay, canary, ramp, and promotion:

   ```bash
   toolkit deploy wait DEPLOYMENT_ID --timeout 86400 --json
   ```

   Success requires the selected runtime and routing proofs. Keep every older
   host that still serves current, ramping, canary, or pinned executions.

4. Request retirement of a drained host through Delivery:

   ```bash
   toolkit deploy workers retire ENVIRONMENT WORKER_ID --json
   ```

   Retirement independently rechecks native drainage and execution visibility.
   It sets the retained host's desired replicas to zero and preserves its record.

5. For a failed deployment that retains ownership, stop its prior executor and
   request independent recovery inspection:

   ```bash
   toolkit deploy workers recover DEPLOYMENT_ID --machine \
     --expected-generation GENERATION \
     --reason "Prior executor stopped; inspect retained hosts and native routing" --json
   toolkit deploy workers recovery INTENT_ID --machine --json
   ```

   Use the environment generation from the deployment details. The independent
   runner remains usable while Temporal is unavailable. Recovery clears ownership
   only after fresh source, host, routing, execution, and generation checks. It
   preserves the failed deployment's outcome. Retain the lock if inspection fails.

Delivery retains its exact host pool and selected artifacts in
PostgreSQL. The central control-plane image is retained separately from the
application candidate and requires its own upgrade procedure.

## Verify the billed LLM cost reconciliation

The reconciliation is healthy when the billing Activity has completed and both
providers report current billed cost. After the candidate carries the
`runLlmBilledCostReconciliation` Workflow, unpause `llm-billed-cost-hourly`,
trigger one run, and check Prometheus:

```promql
sum by (provider, account, window) (llm_billed_cost_usd)
time() - max by (provider) (llm_billed_reconciliation_last_success_timestamp_seconds)
ALERTS{alertname=~"LlmBilled.*"}
```

`LlmBilledReconciliationStale` selects the billing worker by
`namespace="temporal",container="temporal-billing-worker"`; pod-name prefixes
are not stable scrape labels. See
[Attribute LLM spend](/how-to/attribute-llm-spend/#compare-live-and-billed-spend)
for how to read billed against live cost.

## Native diagnostics

Use the existing passthroughs for read-only native inspection:

```bash
toolkit temporal --namespace prod worker deployment describe --name monorepo-central-workflows
toolkit temporal --namespace prod worker deployment describe-version \
  --deployment-name monorepo-central-workflows \
  --build-id <candidate-image-git-sha> \
  --report-task-queue-stats
toolkit prom query 'ALERTS{alertstate="firing",alertname=~"Temporal.*"}'
toolkit loki query '{service_name="temporal-central-workflows"}' --since 1h --limit 50
toolkit tempo --help
```

Record the deployed digest, execution IDs, soak times, and live screenshots in
the pull request or Tracker. Do not create a repository rollout journal.
