---
title: How to install promotion sandbox prerequisites
description: Install and verify the reviewed Talos namespace quota and named seccomp policy before enabling the promotion worker.
---

Install and verify the node policy before releasing a promotion worker that selects its named seccomp profile.
The [bounded operator](packages/homelab/src/talos/promotion-sandbox.ts) targets only the production node and applies a complete configuration without rebooting.

## 1. Prepare the reviewed source

Keep promotion disabled and its schedules paused throughout the node change.
Merge the node prerequisite delivery through the normal review and CI workflow before using its operator command.
Release the chart opt-in separately, after the node checks below pass.

From the repository root, validate the complete public source graph with synthetic credentials:

```bash
bun run --cwd packages/homelab talos:config validate-source
```

The [source validator](packages/homelab/src/talos/machine-config.ts) uses the pinned Talos generator and native full-configuration validation.
This check does not read production secrets or contact the node.
It does not replace validation of the live candidate during planning.

## 2. Review a fresh node plan

Run the read-only plan from the merged checkout:

```bash
bun run --cwd packages/homelab talos:promotion-sandbox
```

The [operator](packages/homelab/src/talos/promotion-sandbox.ts) uses the authenticated `toolkit talosctl` wrapper.
Its output contains only hashes, resource versions, and bounded policy evidence.
Keep the reported `planSha256` for the apply command.

Check that the plan selects the reviewed quota and named profile.
The [runtime guard](packages/homelab/src/talos/promotion-sandbox.ts) requires the profile's pinned Talos release on Linux amd64 metal.
It independently reads the Kubernetes node's containerd version and requires the [profile provenance](packages/homelab/src/talos/seccomp/promotion-policy.json) pin.
The candidate preserves every other live configuration field, including extension documents and credentials.
Native validation receives the complete candidate through stdin.
Do not redirect a full machine configuration, native diff, or credential document to a file.

## 3. Apply the reviewed plan once

Pass the digest from the plan you reviewed:

```bash
bun run --cwd packages/homelab talos:promotion-sandbox --apply REVIEWED_PLAN_SHA256
```

The [apply procedure](packages/homelab/src/talos/promotion-sandbox.ts) regenerates the plan and requires an identical digest.
It requires active and persistent configurations to agree before planning.
Before submission, it checks both resource versions and complete configuration hashes again, along with the runtime pins.
It submits the candidate through stdin only after these checks pass.
This preflight is not an atomic compare-and-swap; coordinate other node configuration work before applying.

If preflight rejects a concurrent change, inspect a new plan before any write.
If submission fails or readback differs, stop and inspect the node.
An unsuccessful transport can follow a successful write, so never blindly repeat the apply or roll back.
After inspecting an uncertain outcome, review a fresh plan.
If its configuration already matches, applying that plan runs verification without resubmitting configuration.

## 4. Require node acceptance before the chart release

Require `applied-and-verified` or `already-configured-and-verified` from the operator.
The [verification sequence](packages/homelab/src/talos/promotion-sandbox.ts) requires both active and persistent configurations to equal the complete candidate semantically.
It then checks the runtime namespace quota, installed profile, and Talos health.
The profile's canonical JSON hash must match the reviewed source.
The receipt also records the actual installed file's byte hash, independently of JSON formatting.

Check existing workloads through their normal health and user-flow probes.
Attach the safe operator receipt and those results to the delivery evidence.
Only then release the separately reviewed chart opt-in.
The node receipt does not establish that the promotion workload's sandbox or network boundaries work.

After rollout, inspect the running promotion container's selected profile, effective capabilities, and `NoNewPrivs` state.
Run its offline sandbox boundary probe before resuming promotion work.
Keep production publishing disabled until its own approved acceptance checks pass.

## 5. Refresh a profile before upgrading its dependencies

Follow the [profile regeneration procedure](packages/homelab/src/talos/README.md) whenever its pinned runtime, provider, or worker capabilities change.
Review the regenerated baseline and exception delta, then rerun the native sandbox matrix and negative boundary probes.
Use a new profile name when its contents change.

Install and verify the replacement profile before releasing a chart that selects it.
Retire an old profile only after no desired or running pod references it.
The [provenance regression](packages/homelab/src/talos/catalog-pins.test.ts) checks the declared compatibility boundary against source pins.

## Related

- [Cut a homelab release](/how-to/cut-a-homelab-release/)
- [Homelab operations overview](/explanation/homelab/operations-overview/)
- [Talos machine configuration source](packages/homelab/src/talos/README.md)
