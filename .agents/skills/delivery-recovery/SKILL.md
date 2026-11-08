---
name: delivery-recovery
description: Unstick Delivery when deployments stop dispatching — a recovery-required or stalled deployment, a held dispatch barrier, a stale recovery intent, a refused preflight, or an operator-run data-layer or OpenTofu release. Use for DeliveryRecoveryRequired, DeliveryQueueStalled or DeliveryRecoveryIntentsPending, or when releases stay queued.
---

# Delivery recovery

Delivery settles most failures itself. An agent acts only on what it could
not settle, through supported commands, and never by editing `delivery_db`.
Load `homelab-operations` for cluster access and `monorepo-delivery` for any
code fix. Use the toolkit built from current main
(`bun packages/toolkit/src/index.ts …`) when the installed binary predates a
command below.

## 1. Find what is held

```bash
toolkit deploy status --json | jq -r '.deployments[] | select(.status=="queued" or .status=="running" or .recoveryRequired) | [.id,.environmentId,.status,.recoveryRequired] | @tsv'
toolkit deploy recovery --pending --json
```

- A self-hosted service (`delivery`, `delivery-control-plane`, `temporal`,
  `argocd`) that is `running` or `recoveryRequired` holds the global dispatch
  barrier: every other claim answers `BUSY`.
- Each dispatch tick opens one intent itself for a recovery-required
  deployment (`requestedBy: delivery/auto-recovery`) and settles `argo`
  intents its reader proves. Wait one tick before acting. Act yourself when
  the intent is `failed`, the deployment is content or compound, or no intent
  appears after a tick (an older Delivery without auto-recovery).

## 2. Learn why it failed

1. Read the deployment and its stages:
   `toolkit deploy status <DEPLOYMENT_ID> --json`. Stage evidence carries the
   refusal text of guarded Argo commands and failed read-only Jobs.
2. Read the Workflow:
   `toolkit temporal workflow show -w delivery/<DEPLOYMENT_ID> -o json`, then
   the failed Activity's message and stack.
3. A refused apply-safety preflight can be reproduced read-only with the
   workstation ArgoCD token and
   `bun packages/homelab/scripts/argocd/argocd.ts assert-apply-safe <APP> --revision <CHART_VERSION>`.

Fix a defective check or chart in source first (a false positive must not be
worked around), then settle the deployment.

## 3. Settle it with its own reader

Never release a lock because a stage looks read-only: each reader proves its
target independently (model D5, I2).

| Deployment                                | Command (admin `--machine` credential)                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker rollout (temporal, scout)          | `toolkit deploy workers recover <ID> --machine --expected-generation <N> --reason "<why>"`. It also proves a written but never-synced Application body. |
| Ordinary Application with a recorded sync | `toolkit deploy recover <ID> --expected-generation <N> --operation-id <ARGO_OPERATION_UUID> --reason "<why>" --machine`                                 |
| OpenTofu or platform                      | `toolkit deploy platform recover <ID> --machine --expected-generation <N> --reason "<why>"`                                                             |
| Static site or Forum                      | `toolkit deploy sites recover` or `toolkit deploy forum recover`, as the release how-to describes                                                       |

Read `<N>` from `environment.generation`. The Argo operation UUID is the
`ci.sjer.red/operation-id` entry of the Application's
`status.operationState.operation.info`.

After settlement the environment stays blocked until a newer automatic
release or an operator start: `toolkit deploy start <ENV> <VERSION_ID> --machine`.

## 4. Close a stale intent

An intent whose deployment already ended without needing recovery:

```bash
toolkit deploy recovery <INTENT_ID> --abandon --reason "<why nothing needs it>" --machine
```

The server refuses while the deployment needs recovery, a producer barrier is
unrestored, or a recovery Workflow owns the intent.

## 5. When no reader applies

Stop and file a Tracker `AI` issue (search first; see
`tracker-work-management`) naming the deployment, its stages and the refused
command. Report it to Jerred; a database change needs his explicit approval
for that deployment and an `Audit` row recording the evidence.

A non-worker Application left with a stale written body needs the ArgoCD
break-glass in
`packages/docs/wiki/src/content/docs/how-to/regain-write-access-to-argocd.md`:
restore `spec.source` to the latest `status.history` entry's source through
the ArgoCD API, return to read-only, and audit `environment.break_glass`.

## 6. Operator-run releases

`delivery-data`, `temporal-data` and `cluster-admission` are `operator-run`:
after `toolkit deploy start`, an operator attests every stage the recipe
lists, in order. Follow
`packages/docs/wiki/src/content/docs/how-to/release-cluster-admission.md`
exactly; for the data layers, substitute the Application name and skip its
`admission-canary` stage, which only `cluster-admission` declares.

The checked sequence, with the `operator-run` ArgoCD account (1Password item
`delivery-argocd-operator-run-token`, read through
`scripts/onepassword/with-service-account.sh`):

1. `argocd.ts assert-apply-safe <APP> --revision <CHART_VERSION>` before any
   mutation; attest `apply-safety` only if it passes.
2. `argocd app set <APP> --revision <CHART_VERSION>`, then
   `argocd.ts sync-managed <APP> --revision <CHART_VERSION> --request-id <UUID>`,
   which repeats the analysis and fails unless the sync finishes; then attest
   `sync`.
3. `cluster-admission` only: run the how-to's admission dry runs and attest
   `admission-canary`.
4. `toolkit deploy wait <DEPLOYMENT_ID>`.

Never sync with plain `argocd app sync`, and never attest a stage you did not
run or that failed; cancel the deployment instead.

A data-layer sync restarts its single PostgreSQL pod; Delivery or Temporal
drops for about 15 seconds. Diff the chart tarballs first.

The operator-only OpenTofu stacks need their owners' credentials (Backblaze
master key, `OP_ACCOUNT` desktop approval, stack passphrases, Google ADC,
Docker login, router login): plan with
`bun packages/homelab/scripts/tofu/tofu-stack.ts <stack> plan` and apply only
after Jerred approves the plan.

## Human-only

Production approvals, a saved-plan approval, the break-glass decision, and
the OpenTofu operator credentials. Everything else in this skill an agent runs
end to end, then verifies the queue drained and reports what it settled.
