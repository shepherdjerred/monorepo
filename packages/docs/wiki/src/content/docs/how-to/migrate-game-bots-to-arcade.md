---
title: How to migrate game bots to Arcade
description: Copy game progress, transfer exclusive Discord account ownership, and preserve a rollback path.
---

Migrate by copying progress first, stopping legacy account owners, and enabling Arcade only after beta acceptance.

1. Build the Arcade image through CI and retain its immutable digest. Prepare private game assets with the [package tools](https://github.com/shepherdjerred/monorepo/tree/3c52fad53400789c802236e9a1be4837336022e6/packages/arcade/runtimes). Keep dumps and generated WASM outside Git and images.
2. Reconcile the [dormant Arcade chart](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/arcade.ts) through the [homelab release procedure](/how-to/cut-a-homelab-release/), selecting `createArcadeDeployment(chart, { controllerActive: false })` in its chart factory. This renders zero controller replicas and a read-only storage preparation job. Wait for that job to complete and all three claims to become `Bound`. Populate the private asset claim. The active mode omits this bootstrap job: ZFS cannot mount its read-only claims alongside the controller's writable save and database mounts.
3. Stop both legacy bot deployments through GitOps. Verify their sessions and streaming accounts have disconnected. Retain both original save claims and the original leaderboard database.
4. Download the stopped legacy save roots and database into a private working directory. Retain this raw snapshot. MK64's per-server engine archive links point into the old container: resolve those known links in a separate private copy using the matching legacy image and ROM-derived archive. The native host replaces these engine links when a session starts. Run `packages/arcade/runtimes/prepare-migration.py` with explicit MK64 save, Emerald save, database, and new output paths. The tool verifies every copied save and SQLite integrity. Keep its manifest with the backup.
5. Copy the verified save and database outputs into the corresponding Arcade claims. Preserve their directory structure. Initialize the additive database schema with the Arcade image; startup refuses destructive schema changes.
6. Preserve the command application's ID and OAuth callback when rebranding it as Arcade. Enable Message Content for Emerald chat input. Create the dedicated vault item with the [declared Arcade credential fields](https://github.com/shepherdjerred/monorepo/blob/4de0ddbb63214dab85d775128dd41def4f22dd7e/packages/homelab/src/cdk8s/src/resources/arcade.ts). Include both game streaming users; keep the [Streambot pool](https://github.com/shepherdjerred/monorepo/blob/4de0ddbb63214dab85d775128dd41def4f22dd7e/packages/homelab/src/cdk8s/src/resources/streambot/streambot.ts) separate. Refresh the vault snapshot. Enable controller ownership using the matching image and [Arcade bootstrap](https://github.com/shepherdjerred/monorepo/blob/4de0ddbb63214dab85d775128dd41def4f22dd7e/packages/arcade/packages/backend/src/index.ts). Use the chart's declared ingress, goal grants, and beta selectors. Keep public rollout off during acceptance.
7. Verify four controller ports, menus, match completion, rematches, save persistence, browser playback, and Discord playback for each multiplayer game. Verify Emerald shared commands and goals. Observe one heavy game alongside MK64 or Emerald before expanding rollout.
8. Publish the configured beta only after checking game speed, input latency, audio/video alignment, and sustained operation. Keep source checks, CI, artifact publication, ArgoCD reconciliation, and observed behavior as separate evidence.

To roll back, stop Arcade through GitOps and verify both streaming accounts are free. Make a new backup of its current saves and database. Copy the latest MK64 and Emerald progress into their legacy save roots before restarting legacy owners. Retain Arcade's database and newer-game saves for the next cutover. Never restore an old snapshot over progress made after migration.

To change the game streaming pool, update the dedicated vault item's token array.
Wait for its Kubernetes secret to reconcile, then restart the controller through
GitOps after active sessions end. The [pool discovers account IDs and guild membership](https://github.com/shepherdjerred/monorepo/blob/4de0ddbb63214dab85d775128dd41def4f22dd7e/packages/discord-stream-lifecycle/src/pool/userbot-pool.ts)
at login; [Arcade rejects duplicate identities](https://github.com/shepherdjerred/monorepo/blob/4de0ddbb63214dab85d775128dd41def4f22dd7e/packages/arcade/packages/backend/src/credentials.ts)
before admission. Check each account belongs to the intended guilds.
Adding tokens does not raise the [configured session limits](https://github.com/shepherdjerred/monorepo/blob/4de0ddbb63214dab85d775128dd41def4f22dd7e/packages/arcade/packages/backend/src/config.ts).
Keep the old Pokémon command application until Arcade acceptance and guild
installation finish. Retain its streaming user in the Arcade pool.

## Related

- [About the homelab](/explanation/homelab/overview/)
- [Arcade package reference](https://github.com/shepherdjerred/monorepo/tree/3c52fad53400789c802236e9a1be4837336022e6/packages/arcade)
