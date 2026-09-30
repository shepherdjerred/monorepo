---
title: Prepare The Storm companion RCON access
description: Provision the one-account companion's RCON credential and verify the repo-owned server configuration before a live pilot.
---

Prepare a dedicated RCON credential in 1Password before releasing The Storm companion's server configuration.

The [Minecraft chart](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.ts) reads one required field from the existing `storm-brain` item. The [pilot](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/brain/README.md) uses the same field locally through `op run`.

1. In the Homelab (Kubernetes) vault, add a concealed `MINECRAFT_RCON_PASSWORD` field to the `storm-brain` item. Generate a unique, strong value in 1Password. Do not copy it into Git, a terminal command, or a chat message.
2. Refresh the hash-only vault snapshot and run the offline reference check:

   ```bash
   cd packages/homelab/src/cdk8s
   bun run scripts/snapshot-1password-vault.ts
   bun run check:1password
   ```

   Commit the refreshed `onepassword-vault-snapshot.json` with the infrastructure change. The check must find the exact `MINECRAFT_RCON_PASSWORD` field before release.

3. Follow [the homelab release guide](/how-to/cut-a-homelab-release/) to publish and reconcile the chart. The server pod requires the 1Password-backed Kubernetes Secret. The RCON Service uses `ClusterIP`; the chart does not publish a public RCON endpoint.
4. After the server wakes, verify the StatefulSet and RCON Service in `minecraft-tsmc`. Use a local port forward for a manual pilot, and stop it afterward. The [pilot README](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/brain/README.md) lists its other gates and private token-cache requirement.

## Related

- [About the homelab](/explanation/homelab/overview/)
- [Connect to a homelab database](/how-to/connect-to-a-homelab-database/) for the local port-forward pattern
