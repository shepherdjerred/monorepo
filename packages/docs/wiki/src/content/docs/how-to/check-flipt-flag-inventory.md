---
title: Check the Flipt flag inventory
description: Compare the repository-managed runtime flag contract with the live Flipt evaluation snapshot.
sidebar:
  order: 9
---

Run the operator-only inventory check when you change Flipt state or need to
diagnose runtime flag drift. A daily Temporal workflow performs the same
key-set check and publishes a `FliptManagedFlagDrift` warning to Alertmanager;
the alert resolves after a later verified aligned snapshot.

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

The command checks every environment declared in the managed inventory. During
the migration, that means `default`, `beta`, and `prod` in the `default`
namespace.

To check one exact environment, pass a filter:

```bash
bun run check-flipt-flag-inventory -- --environment beta
```

`FLIPT_NAMESPACE` changes the namespace. `FLIPT_ENVIRONMENT` is also accepted
as the exact environment filter.

## 3. Interpret failures

The check fails when Flipt differs from the inventory in any of these areas:

- managed key set;
- boolean or variant type;
- default value;
- segment constraints and operators;
- variant rules and distributions;
- percentage threshold rollouts.

Each diagnostic names the failing namespace and environment. Fix the repository
inventory or that environment's audited Flipt state, then run the complete
check again until every environment reports alignment.

When environments intentionally differ, record a full behavioral override in
the environment's inventory entry. An override replaces the flag's default,
segment rollouts, variant rules, and threshold rollouts together. Partial
overrides are rejected so an environment cannot inherit an accidental mixture
of old and new behavior.

The scheduled alert is read-only. It never deletes Flipt flags or edits the
inventory. A failed snapshot request does not resolve an existing alert; the
workflow fails so the Temporal failure watcher can report the unavailable
check separately.

:::caution
Flipt has no authentication. Network reachability is the authorization
boundary, so keep the endpoint private and do not expose it publicly.
:::

## Related

- [Configuration layers](/explanation/homelab/configuration/)
