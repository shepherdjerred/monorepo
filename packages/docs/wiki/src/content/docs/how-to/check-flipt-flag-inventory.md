---
title: Check the Flipt flag inventory
description: Compare the repository-managed runtime flag contract with the live Flipt evaluation snapshot.
sidebar:
  order: 9
---

Run the operator-only inventory check when you change Flipt state or need to
diagnose runtime flag drift. A daily Temporal workflow performs the same
contract check and publishes one independently labelled
`FliptManagedFlagDrift` warning per environment and namespace; each alert
resolves after that pair returns to an aligned snapshot.

## 1. Set the endpoint

Set `FLIPT_URL` to the reachable Flipt endpoint. The checker never guesses an
endpoint and does not run during service startup or CI.

```bash
export FLIPT_URL="https://flipt.tailnet-1a49.ts.net"
```

## 2. Run the check

Run the repository command from the monorepo root:

```bash
bun run check-flipt-flag-inventory
```

The command checks every environment and product namespace declared in the
managed inventory: `beta` and `prod`, each containing `scout`, `birmel`,
`streambot`, `starlight-karma-bot`, `trmnl-dashboard`, and `temporal`.

Filter either dimension independently:

```bash
bun run check-flipt-flag-inventory -- --environment beta
bun run check-flipt-flag-inventory -- --namespace scout
bun run check-flipt-flag-inventory -- --environment beta --namespace scout
```

`FLIPT_ENVIRONMENT` and `FLIPT_NAMESPACE` are also accepted as exact filters.
Without filters, the command always checks the complete twelve-pair matrix.

## 3. Interpret failures

The check fails when Flipt differs from the inventory in any of these areas:

- managed key set;
- boolean or variant type;
- default value;
- segment constraints and operators;
- variant rules and distributions;
- percentage threshold rollouts.

Each diagnostic names the failing namespace and environment. Fix the repository
inventory or that pair's audited Flipt state, then run the complete check again
until all twelve pairs report alignment.

When environments intentionally differ, record a full behavioral override in
the environment's inventory entry. An override replaces the flag's default,
segment rollouts, variant rules, and threshold rollouts together. Partial
overrides are rejected so an environment cannot inherit an accidental mixture
of old and new behavior.

The scheduled alert is read-only. It never deletes Flipt flags or edits the
inventory. A failed snapshot request does not resolve an existing alert; the
workflow fails so the Temporal failure watcher can report the unavailable
check separately.

## 4. Change one namespace in one environment

Select both the intended environment and product namespace in the Flipt UI
before editing a flag. The `beta` and `prod` repositories are independent, and
each namespace has its own flag keyspace inside that repository.

After the edit, check that environment first:

```bash
bun run check-flipt-flag-inventory -- --environment prod --namespace scout
```

Then run the unfiltered command. This catches accidental drift in every managed
environment before the operator change is considered complete.

:::caution
Flipt has no authentication. Network reachability is the authorization
boundary, so keep the endpoint private and do not expose it publicly.
:::

## Related

- [Configuration layers](/explanation/homelab/configuration/)
