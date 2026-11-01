---
title: Delivery model reference
description: Deployment kinds, environment roles, target kinds, evidence kinds, states, scopes, credentials and API routes of the Delivery release system.
sidebar:
  order: 8
---

The [Delivery model](packages/delivery/docs/model.md) defines every term below.
The schemas are exported from the
[model contract](packages/delivery/src/shared/model/contract.ts), and the
routes are served by the [Delivery API](packages/delivery/src/server/app.ts).

## Deployment kinds

Defined in the
[deployment request contract](packages/delivery/src/shared/deployment-request-contract.ts).
`toolkit deploy start` picks `deploy`, `channel-publish` or `operator-run` from
the environment's declared recipe kind.

| Kind              | Selects                                                                    | Model                                                       |
| ----------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `deploy`          | A named set revision with the declared recipe and configuration            | [4.12](packages/delivery/docs/model.md#412-deployment)      |
| `promote`         | The set revision accepted in the promotion source, settled or unmonitored  | [M2](packages/delivery/docs/model.md#416-promotion-tree)    |
| `rollback`        | A previously accepted selection, named by the deployment that froze it     | [V2](packages/delivery/docs/model.md#414-acceptance)        |
| `rebind`          | The accepted set revision with the declared recipe or configuration        | [L2](packages/delivery/docs/model.md#49-selection)          |
| `retire-host`     | Removal of one retained host after drainage proof                          | [E5](packages/delivery/docs/model.md#410-environment)       |
| `channel-publish` | A named set revision published to an audience-facing channel               | [section 5](packages/delivery/docs/model.md#5-target-kinds) |
| `operator-run`    | A named set revision applied by an operator, accepted on attested evidence | [section 5](packages/delivery/docs/model.md#5-target-kinds) |

Every kind that names or promotes a set revision freezes the environment's
declared recipe and configuration. Only `rollback` restores an earlier binding.

Two specialized kinds have their own requests: `adopt-worker` for host-only
worker adoption, and `repair-trmnl` for a TRMNL plugin repair. Records may
also show the retired `root-release`, `tofu-plan`, `tofu-apply` and
`upgrade-control-plane` kinds; no request creates them.

## Environment roles

Defined in the [catalog shape](packages/ops-model/src/catalog-document-shape.ts).

| Role            | Meaning                                                               | Model                                                   |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| `durable`       | Holds its own accepted selection and is a rollback source             | [4.10](packages/delivery/docs/model.md#410-environment) |
| `replica`       | Runs only selections its named durable environment has accepted       | [E7](packages/delivery/docs/model.md#410-environment)   |
| `qualification` | Runs candidates before durable acceptance; its oracle is a test suite | [E7](packages/delivery/docs/model.md#410-environment)   |

## Service and environment fields

| Field           | Values                                    | Model                                                |
| --------------- | ----------------------------------------- | ---------------------------------------------------- |
| Lifecycle       | `active`, `retired`, `removed`            | [4.2](packages/delivery/docs/model.md#42-service)    |
| Approval policy | `none`, `required`                        | [4.13](packages/delivery/docs/model.md#413-approval) |
| Component type  | `image`, `chart`, `archive`               | [4.3](packages/delivery/docs/model.md#43-component)  |
| Producer        | `first-party`, `acquisition`, `reference` | [4.3](packages/delivery/docs/model.md#43-component)  |
| Reference mode  | `pinned`, `tracking`                      | [A5](packages/delivery/docs/model.md#45-artifact)    |
| Monitor policy  | `automatic`, `hold`                       | [W2](packages/delivery/docs/model.md#419-monitor)    |

## Target kinds

A recipe's `kind` names its target. Defined in the
[recipe contract](packages/delivery/src/shared/model/recipe-contract.ts).

| Kind                     | Lock scope                                 | Acceptance oracle                                                |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------- |
| `kubernetes-application` | The Application                            | Synced and healthy, plus recipe probes and declared proofs       |
| `static-site`            | The bucket                                 | Entrypoint readback, HTTP 200 and purge receipt                  |
| `tofu`                   | The stack, plus the `platform` shared lock | Bound plan, successful apply and an advanced state serial        |
| `channel`                | The channel                                | The channel serves the selected artifact with matching integrity |
| `operator-run`           | As the wrapped kind, or a `host:<name>`    | As the wrapped kind, attested by the operator                    |
| `compound`               | Every sub-step instance, canonical order   | Every sub-step accepted                                          |

Each row is defined in [section 5](packages/delivery/docs/model.md#5-target-kinds).

## Prerequisite edge rules

| Rule                      | Holds when the prerequisite environment has accepted              | Model                                                         |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `any-accepted`            | Any selection                                                     | [4.18](packages/delivery/docs/model.md#418-prerequisite-edge) |
| `same-or-later-order-key` | A selection at the same or a later order key than the dependent's | [4.18](packages/delivery/docs/model.md#418-prerequisite-edge) |

## Evidence kinds

Defined in the [evidence contract](packages/delivery/src/shared/evidence-contract.ts).
Evidence is appended and never edited
([V3](packages/delivery/docs/model.md#414-acceptance)).

| Kind             | Records                                                      |
| ---------------- | ------------------------------------------------------------ |
| `ci`             | Provenance of the producing CI pipeline                      |
| `preflight`      | A check run before an effect, such as apply safety           |
| `backup`         | A backup taken or verified before a stateful change          |
| `migration`      | A schema or data migration result                            |
| `reconciliation` | The target's reconciliation of the frozen selection          |
| `runtime`        | An observation of the running workload                       |
| `acceptance`     | The oracle's acceptance result                               |
| `monitor`        | A monitor reaching `settled`                                 |
| `alarm`          | An alarm seen while watching, counted or marked pre-existing |
| `test`           | A qualification or acceptance test result                    |
| `drift`          | Self-heal reverting drift from the accepted selection        |
| `attestation`    | Operator-attested evidence for an `operator-run` stage       |

## States

Defined in the [shared contract](packages/delivery/src/shared/contract.ts)
and beside each object's schema.

| Object          | States                                                                      | Model                                                       |
| --------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Deployment      | `awaiting_approval`, `queued`, `running`, `succeeded`, `failed`, `canceled` | [4.12](packages/delivery/docs/model.md#412-deployment)      |
| Monitor         | `unmonitored`, `watching`, `settled`, `alarmed`                             | [4.19](packages/delivery/docs/model.md#419-monitor)         |
| Approval        | `pending`, `granted`, `rejected`, `expired`                                 | [4.13](packages/delivery/docs/model.md#413-approval)        |
| Recovery intent | `pending`, `succeeded`, `failed`                                            | [4.15](packages/delivery/docs/model.md#415-recovery-intent) |

A `running` deployment is the model's `owned`; `succeeded` is `accepted`.
`recoveryRequired` is a flag on a terminal deployment, not a state: the
deployment keeps its locks until a recovery intent succeeds. `handoffAt` marks
a self-hosted deployment its outgoing executor left for the successor
([D8](packages/delivery/docs/model.md#412-deployment)).

## Recovery intent kinds

Defined in the [recovery intent contract](packages/delivery/src/shared/recovery-intent.ts).
Delivery infers the kind from the deployment.

| Kind             | Inspects                                          | Settled by                                                      |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `argo`           | A `kubernetes-application` sync                   | `POST /recovery-intents/:id/settle`, the API's Application read |
| `worker`         | A `worker-rollout` step                           | The worker recovery Workflow or its operator entrypoint         |
| `platform`       | An OpenTofu plan or apply                         | The platform recovery Workflow or its operator entrypoint       |
| `content`        | A `static-site`, `archive` or `forum-bundle` step | The content recovery operator command                           |
| `minecraft`      | A `minecraft-upgrade` step                        | The Minecraft recovery Workflow and the controller's report     |
| `forum-baseline` | A Forum baseline inspection                       | The Forum baseline Workflow                                     |

The specialized procedures are in the
[Temporal README](packages/temporal/README.md#delivery-execution).

## Scopes

Defined in the [shared contract](packages/delivery/src/shared/contract.ts).

| Scope     | Grants                                                                             |
| --------- | ---------------------------------------------------------------------------------- |
| `read`    | Every `GET` route                                                                  |
| `publish` | CI build registration                                                              |
| `deploy`  | Deployment requests                                                                |
| `approve` | Approval and plan decisions; human identities only                                 |
| `execute` | Executor routes: claim, lease, stages, handoff, successor and monitor observations |
| `attest`  | Operator-run stage attestations; never held with `execute`                         |
| `admin`   | Catalog reconcile, retirement and recovery intents                                 |

## Toolkit credentials

`--machine` resolves one brokered credential per command, in
[`deployMachineCredential`](packages/toolkit/src/commands/deploy/forum.ts).
Without it, a command uses your Tailscale identity.

| Credential                 | Used by                                   |
| -------------------------- | ----------------------------------------- |
| `DELIVERY_ATTEST_TOKEN`    | `deploy attest`                           |
| `DELIVERY_EXECUTOR_TOKEN`  | `deploy qualify`                          |
| `DELIVERY_PUBLISHER_TOKEN` | `deploy forum publish`                    |
| `DELIVERY_API_TOKEN`       | Every other command, with the admin scope |

## Routes

Every route is under `/api/v1`.

| Route                                        | Scope     | Toolkit command                                        | Model                                                       |
| -------------------------------------------- | --------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| `POST /deployments`                          | `deploy`  | `deploy start`, `promote`, `rollback`, `rebind`        | [4.12](packages/delivery/docs/model.md#412-deployment)      |
| `GET /environments/:id/selection`            | `read`    | Read by `start`, `promote`, `rollback` and `rebind`    | [4.9](packages/delivery/docs/model.md#49-selection)         |
| `GET /environments/:id/rollback-candidates`  | `read`    | `deploy candidates <ENVIRONMENT>`                      | [D9](packages/delivery/docs/model.md#412-deployment)        |
| `GET /environments/:id/monitor`              | `read`    | `deploy monitor <ENVIRONMENT>`                         | [4.19](packages/delivery/docs/model.md#419-monitor)         |
| `POST /deployments/:id/approval`             | `approve` | `deploy approve`, `deploy reject`, with `--override`   | [4.13](packages/delivery/docs/model.md#413-approval)        |
| `POST /deployments/:id/plan-approval`        | `approve` | `deploy approve-plan`, `deploy reject-plan`            | [H6](packages/delivery/docs/model.md#413-approval)          |
| `POST /deployments/:id/attestations`         | `attest`  | `deploy attest <DEPLOYMENT_ID>`                        | [section 5](packages/delivery/docs/model.md#5-target-kinds) |
| `POST /deployments/:id/recovery-intents`     | `admin`   | `deploy recover <DEPLOYMENT_ID>`                       | [I1](packages/delivery/docs/model.md#415-recovery-intent)   |
| `POST /recovery-intents/:id/settle`          | `admin`   | `deploy recover <DEPLOYMENT_ID> --operation-id <UUID>` | [I2](packages/delivery/docs/model.md#415-recovery-intent)   |
| `GET /recovery-intents/:id`                  | `read`    | `deploy recovery <INTENT_ID>`                          | [4.15](packages/delivery/docs/model.md#415-recovery-intent) |
| `POST /catalog/reconcile`                    | `admin`   | `deploy catalog reconcile --file <PATH>`               | [4.1](packages/delivery/docs/model.md#41-catalog)           |
| `GET /catalog`                               | `read`    | None; the hub                                          | [4.1](packages/delivery/docs/model.md#41-catalog)           |
| `POST /services/:id/retire`                  | `admin`   | `deploy retire <SERVICE>`                              | [S3](packages/delivery/docs/model.md#42-service)            |
| `GET /monitors/watching`                     | `execute` | None; the dispatch monitor loop                        | [W1](packages/delivery/docs/model.md#419-monitor)           |
| `POST /deployments/:id/monitor/observations` | `execute` | None; the dispatch monitor loop                        | [W2](packages/delivery/docs/model.md#419-monitor)           |
| `POST /deployments/:id/handoff`              | `execute` | None; the outgoing self-hosted executor                | [D8](packages/delivery/docs/model.md#412-deployment)        |
| `POST /deployments/:id/successor`            | `execute` | None; the successor Workflow                           | [D8](packages/delivery/docs/model.md#412-deployment)        |

## Backups

Velero's scheduled backups are the only backup of Delivery's record and
artifact stores ([PC1](packages/delivery/docs/model.md#2-guarantees)). Delivery
writes no snapshot or replica of its own.
