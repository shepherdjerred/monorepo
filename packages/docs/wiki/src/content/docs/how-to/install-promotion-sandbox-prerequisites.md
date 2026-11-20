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

Check that the plan selects the reviewed quota and lists every declared profile under `profiles`.
The [runtime guard](packages/homelab/src/talos/promotion-sandbox.ts) requires the selected profile's pinned Talos release on Linux amd64 metal.
It independently reads the Kubernetes node's containerd version and requires the selected [profile provenance](packages/homelab/src/talos/seccomp/promotion-policy.json) pin.
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
It then checks the runtime namespace quota, every installed profile, and Talos health.
Each profile's canonical JSON hash must match the reviewed source.
The receipt's `installedProfiles` also records each installed file's byte hash, independently of JSON formatting.

Check existing workloads through their normal health and user-flow probes.
Attach the safe operator receipt and those results to the delivery evidence.
Only then release the separately reviewed chart opt-in.
The node receipt does not establish that the promotion workload's sandbox or network boundaries work.

After rollout, inspect the running promotion container's selected profile, effective capabilities, and `NoNewPrivs` state.
Verify that its mounted `/tmp` is owned by root with mode `01777`.
The promotion pod's existing [firewall init container](packages/homelab/src/cdk8s/src/resources/temporal/workers/agent-worker.ts) verifies ownership and sets this mode on the shared temporary volume before the worker starts.
Its sticky bit prevents provider subprocesses from replacing parent-owned temporary files; the runtime guard rejects an unprotected directory.
Run its offline sandbox boundary probe before resuming promotion work.
Keep production publishing disabled until its own approved acceptance checks pass.

## 5. Replace a profile before upgrading its dependencies

Replace the profile whenever its pinned runtime, provider, or worker capabilities change.
A profile never changes under its name, so a replacement is a second profile that the node carries beside the first.
The [provenance file](packages/homelab/src/talos/seccomp/promotion-policy.json) lists every profile the node carries and names the one the chart selects.

### Stage the replacement

Follow the [profile regeneration procedure](packages/homelab/src/talos/README.md) to add the replacement's provenance entry and generated patch.
Leave `selected` on the current profile.
Review the regenerated baseline against the current one, and confirm the exception delta is unchanged.
Deliver that change on its own; it alters no workload.

### Install it beside the current profile

Run this while the node still runs the release the current profile was reviewed for.
The runtime guard follows the selected profile, so it accepts that release and refuses the replacement's.

```bash
bun run --cwd packages/homelab talos:promotion-sandbox
```

Check that `profiles` lists both names with the hashes you reviewed.
Check that `changedPaths` names only the namespace quota and those two profiles.
Then apply the reviewed digest, as in step 3:

```bash
bun run --cwd packages/homelab talos:promotion-sandbox --apply REVIEWED_PLAN_SHA256
```

Require `applied-and-verified` with both profiles under `installedProfiles`.
Confirm the running worker still selects the current profile and is ready:

```bash
kubectl -n temporal get deployment temporal-temporal-promotion-worker \
  --output jsonpath='{.spec.template.spec.containers[0].securityContext.seccompProfile.localhostProfile}{"\n"}{.status.readyReplicas}{"\n"}'
```

### Switch the chart with the dependency

Change `selected` in the same delivery that moves the dependency's source pin.
The [provenance regression](packages/homelab/src/talos/catalog-pins.test.ts) fails until the selected profile's Talos release, provider version, and capabilities match the source pins, so neither change can merge without the other.
For a Talos or containerd change, perform the live upgrade as part of that delivery, following the [upgrade procedure](packages/homelab/README.md).
Then confirm the node reports the replacement's reviewed runtime:

```bash
kubectl get node torvalds \
  --output jsonpath='{.status.nodeInfo.osImage}{"\n"}{.status.nodeInfo.containerRuntimeVersion}{"\n"}'
```

Run the plan again from that delivery's checkout.
Its guard now requires the upgraded runtime, and applying the plan must report `already-configured-and-verified`.
Until the chart rolls out, the worker keeps the previous profile on the upgraded runtime; keep promotion disabled for that interval.

After the chart release, confirm the rollout and the selected profile:

```bash
kubectl -n temporal rollout status deployment/temporal-temporal-promotion-worker
kubectl -n temporal get pods --selector component=promotion-worker \
  --output jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.containers[0].securityContext.seccompProfile.localhostProfile}{" "}{.status.containerStatuses[0].ready}{"\n"}{end}'
```

Repeat the workload acceptance in step 4, including the native sandbox matrix and negative boundary probes, before resuming promotion work.

### Retire the previous profile

Retire a profile only after no desired or running pod references it.
Remove its provenance entry and patch in a later delivery.
The operator installs profiles and never removes one, so a retired profile stays on the node as unowned configuration until a separately reviewed node change deletes it.

## Related

- [Cut a homelab release](/how-to/cut-a-homelab-release/)
- [Homelab operations overview](/explanation/homelab/operations-overview/)
- [Talos machine configuration source](packages/homelab/src/talos/README.md)
