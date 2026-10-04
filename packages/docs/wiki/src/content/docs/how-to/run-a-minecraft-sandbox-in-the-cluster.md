---
title: Run a Minecraft sandbox in the cluster
description: Boot a disposable Paper or the-storm-server sandbox in the homelab's mc-sandbox namespace and drive it with toolkit mc.
---

Run a harness sandbox on the CI node instead of local Docker, for example to
check behavior on the published `the-storm-server` image (amd64-only) or to keep
heavy builds off your laptop. Everything after `sandbox up` works the same as a
Docker sandbox; see the
[mc-harness README](https://github.com/shepherdjerred/monorepo/blob/main/packages/mc-harness/README.md#cluster-sandboxes)
for how the provider works.

Before you start, you need:

- the `admin@torvalds` kube context (or set `MC_KUBE_CONTEXT`), which can
  impersonate the `mc-sandbox:mc-harness` ServiceAccount;
- the homelab `mc-sandbox` chart released, which creates the namespace, quota,
  admission policy and RBAC;
- for the `paper` and `storm-dev` profiles, `MCBridge.jar` built locally
  (`mise exec -- gradle -p packages/the-storm/plugin :bridge:assemble`).

1. Check that the harness identity can create pods:

   ```bash
   kubectl --context admin@torvalds -n mc-sandbox \
     --as=system:serviceaccount:mc-sandbox:mc-harness auth can-i create pods
   ```

   It must print `yes`. The daemon runs the same check before its first cluster
   sandbox and fails with this explanation if it does not.

2. Boot the sandbox. `storm-prod` and `storm-candidate` default to the cluster;
   other profiles need `--provider kubernetes`. Cluster sandboxes live at most
   8 hours.

   ```bash
   toolkit mc sandbox up --profile storm-prod --ttl 2h
   toolkit mc sandbox up --profile paper --provider kubernetes --world void
   ```

   The first boot of an image on the node pulls it, which can take a few
   minutes. Progress shows staging, pod scheduling, the Paper boot, and the
   port-forward.

3. Use the printed id with any `toolkit mc` command, or omit `--target` while it
   is the only sandbox:

   ```bash
   toolkit mc info --target sbx-1a2b3c
   toolkit mc playtest run packages/the-storm/playtests --target sbx-1a2b3c
   ```

4. Remove it when you are done. Sandboxes not started with `--keep` are also
   removed at their TTL, when the daemon stops, and by the pod deadline if the
   daemon never comes back.

   ```bash
   toolkit mc sandbox down sbx-1a2b3c
   ```

## If a sandbox does not boot

- **Pending past the deadline:** the error includes the scheduler's reason.
  The namespace quota allows three sandboxes; remove one with
  `toolkit mc sandbox ls` and `sandbox down`.
- **`ImagePullBackOff` or `CreateContainerConfigError`:** the provider fails
  immediately and saves the server log to
  `~/.toolkit/mc/sandboxes/<id>/failed-boot.log`.
- **Bridge health check times out on `storm-prod`:** the pinned image predates
  MCBridge; use `storm-candidate` or promote an image that bakes it.

## Related

- [Connect to a homelab database](/how-to/connect-to-a-homelab-database/) for the port-forward pattern
- [Cut a homelab release](/how-to/cut-a-homelab-release/) to release the mc-sandbox chart
