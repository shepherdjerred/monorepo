---
title: How to migrate game bots to Arcade
description: Copy game progress, transfer exclusive Discord account ownership, and preserve a rollback path.
---

Migrate by copying progress first, stopping legacy account owners, and enabling Arcade only after beta acceptance.

1. Build the Arcade image through CI and retain its immutable digest. Prepare private game assets with the [package tools](https://github.com/shepherdjerred/monorepo/tree/3c52fad53400789c802236e9a1be4837336022e6/packages/arcade/runtimes). Keep dumps and generated WASM outside Git and images.
2. Reconcile the [dormant Arcade chart](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/arcade.ts) through the [homelab release procedure](/how-to/cut-a-homelab-release/). Wait for the storage preparation job to complete and all three claims to become `Bound`. The job mounts them read-only on Arcade's assigned node. Populate its private asset claim. Leave account ownership inactive.
3. Stop both legacy bot deployments through GitOps. Verify their sessions and streaming accounts have disconnected. Retain both original save claims and the original leaderboard database.
4. Download the stopped legacy save roots and database into a private working directory. Retain this raw snapshot. MK64's per-server engine archive links point into the old container: resolve those known links in a separate private copy using the matching legacy image and ROM-derived archive. The native host replaces these engine links when a session starts. Run `packages/arcade/runtimes/prepare-migration.py` with explicit MK64 save, Emerald save, database, and new output paths. The tool verifies every copied save and SQLite integrity. Keep its manifest with the backup.
5. Copy the verified save and database outputs into the corresponding Arcade claims. Preserve their directory structure. Initialize the additive database schema with the Arcade image; startup refuses destructive schema changes.
6. Set the intended Arcade public origin, register its Discord OAuth callback, and enable the bot's Message Content intent for Emerald chat input. Enable one Arcade replica with controller ownership active. Declare ingress through the owning homelab source once the backend is healthy; the dormant chart publishes no route. Select beta for both the Flipt environment and Arcade's deployment environment. Set allowed goal guilds through typed configuration. Keep public rollout off and enable only the beta target.
7. Verify four controller ports, menus, match completion, rematches, save persistence, browser playback, and Discord playback for each multiplayer game. Verify Emerald shared commands and goals. Observe one heavy game alongside MK64 or Emerald before expanding rollout.
8. Publish the configured beta only after checking game speed, input latency, audio/video alignment, and sustained operation. Keep source checks, CI, artifact publication, ArgoCD reconciliation, and observed behavior as separate evidence.

To roll back, stop Arcade through GitOps and verify both streaming accounts are free. Make a new backup of its current saves and database. Copy the latest MK64 and Emerald progress into their legacy save roots before restarting legacy owners. Retain Arcade's database and newer-game saves for the next cutover. Never restore an old snapshot over progress made after migration.

## Related

- [About the homelab](/explanation/homelab/overview/)
- [Arcade package reference](https://github.com/shepherdjerred/monorepo/tree/3c52fad53400789c802236e9a1be4837336022e6/packages/arcade)
