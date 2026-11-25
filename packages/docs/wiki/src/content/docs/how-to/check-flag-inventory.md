---
title: Operate feature flags and check the inventory
description: Inspect, edit, and reconcile live deployment documents in the first-party Flags service against the repository inventory.
sidebar:
  order: 9
---

Use the Flags browser UI, `toolkit flags`, or the repository inventory check to
inspect and update live flag deployments. The `flag-inventory-sync` Temporal
schedule reconciles missing and retired keys every two minutes and publishes one
`FlagsManagedFlagDrift` warning per drifted deployment until the live document
matches the repository inventory.

## 1. Edit a flag in the operator UI

Open `https://flags.tailnet-1a49.ts.net` from a signed-in tailnet device. The
[operator shell](https://github.com/shepherdjerred/monorepo/blob/main/packages/flags/src/client/app.tsx)
authenticates your Tailscale identity through the verified ingress proxy.

1. Choose a deployment in the sidebar. Prod-only catalogs appear as one row;
   `scout` and `starlight-karma-bot` group their `beta` and `prod` stages.
2. Check the table's **State** (`On`, `Off`, or `Targeted` for booleans; the
   current string value for variants) and **Type** (`boolean` or `variant`).
3. Select a flag to open the
   [revision-checked editor](https://github.com/shepherdjerred/monorepo/blob/main/packages/flags/src/client/editor.tsx).
   Update a boolean's default or ordered segment constraints (`Property`,
   `Value`, and segment result), or edit a variant's string value.
4. Click **Review save**, compare the **Before** and **After** flag payloads in
   the confirmation dialog, and click **Save**.
5. If another write landed first, the save stops with **Revision conflict** and
   writes nothing. Compare **Their flag** with **Your draft**, click **Load
   their version**, and re-apply your intended edit.

Changing a managed flag in the UI without updating
[`managed-flag-inventory.json`](https://github.com/shepherdjerred/monorepo/blob/main/packages/feature-flags/src/managed-flag-inventory.json)
raises drift on the next reconciliation run.

## 2. Inspect and apply changes with `toolkit flags`

[`toolkit flags`](https://github.com/shepherdjerred/monorepo/blob/main/packages/toolkit/src/lib/flags/client.ts)
calls the management API over the tailnet using your Tailscale identity, or
brokers `FLAGS_MACHINE_TOKEN` from `flags-auth` when `--machine` is passed. The
endpoint resolves from `--url`, `FLAGS_URL`, `[flags].url`, or
`https://flags.tailnet-1a49.ts.net`.

| Command                                          | Purpose                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `toolkit flags deployments [--json]`             | List every stored deployment, its current revision, and its flag count.                 |
| `toolkit flags list <deployment> [--json]`       | List keys, types, and `on`/`off`/`targeted` or variant values in `<catalog>/<stage>`.   |
| `toolkit flags get <deployment> <flag> [--json]` | Print one flag and the deployment's current `revision`.                                 |
| `toolkit flags diff [--json]`                    | Compare all deployments against the inventory; exits `1` when any key is drifted.       |
| `toolkit flags apply --file <json> [--machine]`  | Apply a reviewed JSON batch bound to `expectedRevision`; exits `2` on conflict (`409`). |

Read the current revision first, then submit an exact JSON file:

```bash
toolkit flags get scout/prod dares_enabled --json
toolkit flags apply --file reviewed.json
```

`reviewed.json` names the deployment, `expectedRevision`, and replacement flag
entries (`{ "deployment": "scout/prod", "expectedRevision": 12, "flags": [...] }`).
Use `--machine` in non-tailnet or automated sessions so toolkit injects the
brokered bearer token without printing it.

## 3. Run the snapshot inventory check

Set `FLAGS_URL` (or pass `--url`) before running the
[inventory checker](https://github.com/shepherdjerred/monorepo/blob/main/scripts/checks/check-flag-inventory.ts).
The command reads credentialless evaluation snapshots and never guesses an
endpoint:

```bash
export FLAGS_URL="https://flags.tailnet-1a49.ts.net"
bun run check-flag-inventory
```

Without filters, it checks every active deployment in
[`deployments.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/feature-flags/src/deployments.ts).
Scope to one deployment or filter by catalog and stage environment:

```bash
bun run check-flag-inventory -- --deployment scout/prod
bun run check-flag-inventory -- --deployment minecraft/tsmc
bun run check-flag-inventory -- --environment beta --namespace scout
```

`FLAGS_DEPLOYMENT` is also accepted as an exact deployment filter. The check
exits non-zero when a snapshot differs from the projected inventory in its key
set, flag type, boolean default, ordered segment constraints, or variant string
value.

## 4. Create missing declared keys

Insert newly declared inventory keys before the next scheduled run without
overwriting existing live values or targeting:

```bash
FLAGS_URL="https://flags.tailnet-1a49.ts.net" \
  toolkit run --env FLAGS_MACHINE_TOKEN -- \
  bun run check-flag-inventory -- --apply-missing
```

`--apply-missing` calls `create-missing` on each selected deployment, leaves
existing flags untouched, and re-runs the snapshot verification.

Scheduled reconciliation also retires only the exact tuples listed in
[`retired-flag-declarations.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/feature-flags/src/retired-flag-declarations.ts).
Audit deployed consumers before adding a retirement; any key still present in
the managed inventory fails preflight before mutation.

## 5. Plan and apply a declared rollout

Update `packages/feature-flags/src/managed-flag-inventory.json` before changing
an existing rollout. Keep any non-global boolean's `defaultOffExceptions` scoped
to its environment with a reason, `AI` issue, enablement criteria, and review
date (or `noDeployedConsumer: true`).

Preview the selected keys for one deployment:

```bash
FLAGS_URL="https://flags.tailnet-1a49.ts.net" \
  bun run check-flag-inventory -- --plan-declared \
  --deployment streambot/prod \
  --flag streambot-lol-esports-enabled --flag streambot-lol-autoplay-enabled --json
```

Inspect the `before`, `after`, and `revisionBefore` fields, then apply with the
brokered machine token:

```bash
FLAGS_URL="https://flags.tailnet-1a49.ts.net" \
  toolkit run --env FLAGS_MACHINE_TOKEN -- \
  bun run check-flag-inventory -- --apply-declared \
  --deployment streambot/prod \
  --flag streambot-lol-esports-enabled --flag streambot-lol-autoplay-enabled --json
```

Both modes require `--deployment <catalog/stage>` (or both `--environment` and
`--namespace`) and at least one `--flag`. `--apply-declared` binds
`expectedRevision`, writes only planned changes, and verifies a fresh readback.
Re-run the unfiltered `bun run check-flag-inventory` command afterwards,
check the Feature flags Grafana dashboard, and exercise the live application
behavior.

:::caution
In-cluster evaluation on port `7361` stays credentialless and rejects
`Authorization` headers. Management routes on port `7360` require verified
Tailscale operator identity or `FLAGS_MACHINE_TOKEN` from `flags-auth`, as
wired in the
[Flags deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/flags/index.ts).
Never place `FLAGS_MACHINE_TOKEN` in consumer configuration.
:::

## Related

- [Configuration layers](/explanation/homelab/configuration/)
- [Homelab control-plane access](/reference/homelab-control-plane-access/)
