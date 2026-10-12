---
title: Prepare The Storm companion RCON access
description: Provision the server RCON credential used by Temporal to reconcile Citizens companions without waking Minecraft.
---

Prepare a dedicated RCON credential in 1Password before releasing The Storm companion's server configuration.

The [Minecraft chart](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.ts) reads one required field from the existing `storm-brain` item. The [Temporal schedule](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/minecraft-schedule-definitions.ts) reconciles companions through the server container's authenticated `rcon-cli`.

1. In the Homelab (Kubernetes) vault, add a concealed `MINECRAFT_RCON_PASSWORD` field to the `storm-brain` item. Generate a unique, strong value in 1Password. Do not copy it into Git, a terminal command, or a chat message.
2. Refresh the hash-only vault snapshot and run the offline reference check:

   ```bash
   cd packages/homelab/src/cdk8s
   bun run scripts/snapshot-1password-vault.ts
   bun run check:1password
   ```

   Commit the refreshed `onepassword-vault-snapshot.json` with the infrastructure change. The check must find the exact `MINECRAFT_RCON_PASSWORD` field before release.

3. Follow [the homelab release guide](/how-to/cut-a-homelab-release/) to publish and reconcile the chart. The server pod requires the 1Password-backed Kubernetes Secret. The RCON Service uses `ClusterIP`; the chart does not publish a public RCON endpoint.
4. After the server wakes, verify the StatefulSet and RCON Service in `minecraft-tsmc`. Execute `companion reconcile` through the authenticated server container and confirm its acknowledgement. Review `/companion status` before enabling the gameplay rollout. See the [Storm contributor reference](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/README.md) for module, managed flag and journal controls.

## Related

- [About the homelab](/explanation/homelab/overview/)
- [Connect to a homelab database](/how-to/connect-to-a-homelab-database/) for the local port-forward pattern
- [Operate The Storm with the agent harness](/how-to/operate-the-storm-with-the-agent-harness/) for guarded agent changes through MCBridge, which reads `MC_BRIDGE_TOKEN` from the same `storm-brain` item
