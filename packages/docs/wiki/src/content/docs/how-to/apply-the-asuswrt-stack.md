---
title: Apply the asuswrt stack
description: Install the local provider, import the router and access points, and run plan and apply from a machine that can reach the home LAN.
sidebar:
  order: 9
---

The `asuswrt` stack is applied by hand, from a machine on the home LAN. CI never
runs it.

Step 1 runs from anywhere in the checkout. Step 2 onward runs from
`packages/homelab/src/tofu`.

## 1. Install the provider

The provider is not published to a registry, so build it into the local
filesystem mirror first. This one is anchored to the repository root, so it runs
from anywhere in the checkout:

```bash
make -C "$(git rev-parse --show-toplevel)/packages/terraform-provider-asuswrt" install
```

## 2. Initialize, import, plan, apply — from `packages/homelab/src/tofu`

`op run` reads the `.env` in that directory and injects the router login from
1Password at runtime, so no credential lands on disk.

```bash
op run --env-file=.env -- tofu -chdir=asuswrt init
op run --env-file=.env -- ./asuswrt/import.sh
op run --env-file=.env -- tofu -chdir=asuswrt plan
op run --env-file=.env -- tofu -chdir=asuswrt apply
```

`import.sh` skips resources already in state, so run it on every pass, not only
the first. Rerun it whenever you add a resource for something that already
exists on the device — a lease, a port forward, a radio. Skipping the import
there makes `apply` create a duplicate NVRAM entry instead of adopting the live
one.

Adding a tracked resource therefore takes two edits, not one: the `.tf` file,
and a matching `address<TAB>import-id` line in the `IMPORTS` heredoc inside
`packages/homelab/src/tofu/asuswrt/import.sh`. That heredoc is the import list.
A resource missing from it is never imported, so `apply` creates the duplicate
this step exists to prevent.

## 3. Confirm the plan is empty

After a successful import, `plan` must report no changes. A non-empty plan
straight after import means a read is misparsing firmware output, not that the
device drifted.

:::caution
Do not apply a wireless change you have not verified against the hardware in
front of you. The write path does not fully model firmware `wl_bw` codes,
chanspec sideband forms, or SAE `wl_mfp`, so an apply can reformat a working
radio into something the firmware accepts but you did not intend. Reads,
imports, and plans are safe. See
[why the wireless write path is not trusted](/explanation/homelab/asuswrt-local-apply/).
:::

## Related

- [Why this stack is applied by hand](/explanation/homelab/asuswrt-local-apply/)
