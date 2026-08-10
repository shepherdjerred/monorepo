---
title: Apply the asuswrt stack
description: Install the local provider, import the router and access points, and run plan and apply from a machine that can reach the home LAN.
sidebar:
  order: 9
---

The `asuswrt` stack is applied by hand, from a machine on the home LAN. CI never
runs it.

Run everything below from `packages/homelab/src/tofu`.

## 1. Install the provider

The provider is not published to a registry, so build it into the local
filesystem mirror first:

```bash
make -C packages/terraform-provider-asuswrt install
```

## 2. Initialize, import, plan, apply

`op run` injects the router login from 1Password at runtime, so no credential
lands on disk.

```bash
op run --env-file=.env -- tofu -chdir=asuswrt init
op run --env-file=.env -- ./asuswrt/import.sh   # first time only
op run --env-file=.env -- tofu -chdir=asuswrt plan
op run --env-file=.env -- tofu -chdir=asuswrt apply
```

`import.sh` is idempotent per resource but only needs a first run; the per-device
import list lives in `packages/homelab/src/tofu/asuswrt/README.md`.

## 3. Confirm the plan is empty

After a successful import, `plan` must report no changes. A non-empty plan
straight after import means a read is misparsing firmware output, not that the
device drifted.

:::caution
Do not apply a wireless change you have not verified against the hardware in
front of you. The wireless write path is unproven and can reformat a working
radio; the gap is tracked in
`packages/docs/todos/asuswrt-wireless-write-path.md`.
:::

## Related

- [Why this stack is applied by hand](/explanation/homelab/asuswrt-local-apply/)
