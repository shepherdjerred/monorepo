---
title: CI agent pool and admission queue reference
description: Each Woodpecker agent pool's slots, queue and workloads, each Kueue ClusterQueue's quota on liskov, the admission priorities, and the node totals they must fit.
sidebar:
  order: 10
---

Every CI workflow runs on one Woodpecker agent pool, and every pod it creates
waits in one Kueue ClusterQueue on liskov. The
[admission budget](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/misc/ci-admission-budget.json)
is the source for the CI figures below.
[Why CI jobs queue instead of failing](/explanation/homelab/ci-admission/)
explains the design.

## Agent pools

[Routing](https://github.com/shepherdjerred/monorepo/blob/main/packages/woodpecker-config-extension/src/pipeline/routing.ts)
labels each workflow with one pool. Each
[agent](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/woodpecker/agent.ts)
takes only workflows with its mandatory `ci-pool` label.

| Pool          | Takes                                                                                          | Slots | LocalQueue | Workspace |
| ------------- | ---------------------------------------------------------------------------------------------- | ----: | ---------- | --------- |
| `pr`          | Every other PR workflow; benchmarks, reproductions and the extended tier                       |    12 | `default`  | 32Gi      |
| `pr-light`    | PR workflows with no services whose every container is in the light, scanner or contained tier |     4 | `ci-light` | 32Gi      |
| `main`        | Pushes and manual runs on the default branch                                                   |    10 | `default`  | 32Gi      |
| `maintenance` | Temporal-dispatched CI maintenance (`CI_MAINTENANCE_KIND`)                                     |     1 | `default`  | 32Gi      |
| `review`      | Review gates                                                                                   |     3 | `ci-gates` | 1G        |
| `completion`  | The checkout-free `ci-complete` verdict on the trusted gate image                              |     1 | `ci-gates` | 1G        |

The slots total 31 (`maxWorkflows`). Today `pr-light` takes `trivy`, `semgrep`,
`trmnl-validate` and `draft-preflight`.

## Kueue ClusterQueues

[Kueue's configuration](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/kueue-config.ts)
builds these queues. None joins a cohort, so none lends or borrows quota.
Preemption is `Never` on all of them.

| ClusterQueue             | LocalQueue       | CPU | Memory | Ephemeral | Pods | Admits                              |
| ------------------------ | ---------------- | --: | -----: | --------: | ---: | ----------------------------------- |
| `woodpecker`             | `default`        |  21 |   64Gi |      56Gi |   69 | `pr`, `main` and `maintenance` pods |
| `woodpecker-light`       | `ci-light`       |   2 |    8Gi |       8Gi |    4 | `pr-light` pods                     |
| `woodpecker-gates`       | `ci-gates`       |   1 |    2Gi |       4Gi |    4 | `review` and `completion` pods      |
| `woodpecker-maintenance` | `ci-maintenance` |   1 |    2Gi |       2Gi |    1 | The Temporal maintenance worker     |
| `delivery`               | `delivery`       |   2 |    8Gi |      32Gi |    1 | One Delivery executor stage Job     |

Delivery's two Job namespaces each have a `delivery` LocalQueue for stage
Jobs and a `default` LocalQueue on `woodpecker`. The `woodpecker` pods quota
is three pods per slot: a step and up to two services. The
`woodpecker-light` quota holds every `pr-light` slot's largest pod at once:
four slots of 500m CPU, a 2Gi checkout and 2Gi of ephemeral storage.

## Admission priorities

| WorkloadPriorityClass | Value | Workloads                   |
| --------------------- | ----: | --------------------------- |
| `ci-main`             |   300 | Main pipelines; maintenance |
| `ci-ready`            |   200 | Ready PRs                   |
| `ci-draft`            |   100 | Drafts; background work     |

Every CI pod keeps the Kubernetes `batch-low` priority.

## Shared concurrency caps

| Workflow         | Group            | Limit | Bounds                                        |
| ---------------- | ---------------- | ----: | --------------------------------------------- |
| `docker-e2e`     | `docker-e2e`     |     3 | Tempo and MinIO held while the step waits     |
| `paper-smoke-pr` | `paper-smoke-pr` |     6 | Paper and the brain held while the step waits |

A cap applies across every agent, PR and main push.
[`check-ci-admission-budget.ts`](https://github.com/shepherdjerred/monorepo/blob/main/scripts/checks/ci/check-ci-admission-budget.ts)
counts only the capped number of held service sets.

## Node totals

[`kueue-config.test.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/kueue-config.test.ts)
holds these sums to liskov's allocatable capacity. The resident column is
the allowance for requests outside Kueue, measured with six agents.

| Resource  | Every queue | Resident requests outside Kueue | Allocatable |
| --------- | ----------: | ------------------------------: | ----------: |
| CPU       |          27 |                 2.0 (1.93 live) |          29 |
| Memory    |        84Gi |                 7Gi (6.96 live) |      91.5Gi |
| Ephemeral |       102Gi |                               — |     836 GiB |

The sums cover the source quotas only. A queue quota changed by hand on the
cluster is outside them until ArgoCD restores the source value.

## Related

- [Why CI jobs queue instead of failing](/explanation/homelab/ci-admission/)
- [CI test tier reference](/reference/ci-test-tiers/)
