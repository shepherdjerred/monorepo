---
title: How to provision The Storm settlement
description: Prepare, inspect, apply, and recover the authored survival settlement without overwriting existing builds.
---

Provision the settlement with admission disabled, then activate it through the repository release path.

1. While running the current image, create separate NORMAL superflat void worlds named `settlement` and `rustworks` through Multiverse, matching the [native fixture world setup](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/the-storm/plugin/dist/src/e2e/java/com/shepherdjerred/thestorm/e2e/StormFixtures.java).
   Use one air layer, the void biome, and no generated structures. Rehearse the pinned
   Multiverse command syntax in a disposable server before using it live.
   Persist both worlds in Multiverse's runtime catalog so they load before The Storm, as required by its [plugin dependencies](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/the-storm/plugin/dist/src/main/resources/paper-plugin.yml) and [towns world validation](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/the-storm/plugin/modules/towns/src/main/java/com/shepherdjerred/thestorm/towns/adapter/paper/TownsPaper.java).
   Set each world spawn to its configured arena lobby after installing its safe platform.
   Preserve the source world's difficulty when moving existing maps.
   For new maps, choose a non-peaceful difficulty so native hostile spawns are permitted.
   Keep arena worlds outside the [resource-world and random-teleport registry](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/the-storm/server/owned/plugins/TheStorm/world.yml).
2. Confirm both worlds are loaded and persisted before releasing the revised town regions.
   Set `enabled: false` in the [Settlement](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/the-storm/server/owned/plugins/TheStorm/arena/survival.yml) and [Rustworks](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/the-storm/server/owned/plugins/TheStorm/arena/rustworks.yml) configuration, then release it.
   Keep the authored footprint and blueprint in the reviewed repository revision.
   Arena admission settings do not bypass the towns module's world validation.
3. Inspect the selected site in a local world copy and check current claims.
   Keep an immutable copy of the original region files.
4. Run `/settlement preview` as an administrator. The [provisioner](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/the-storm/plugin/modules/arena/src/main/java/com/shepherdjerred/thestorm/arena/adapter/paper/SettlementProvisioner.java) checks ownership,
   existing blocks, and the exact bounded footprint. Resolve every reported conflict.
5. Inspect the placement and run `/settlement apply <preview-token>`.
   The immutable database backup commits before the first block changes.
   Wait for the `APPLIED` result and retain its token.
6. Repeat the preview and apply procedure with `/rustworks` for its own world.
   Inspect buildings, rising streets, entrances, crafting stations, the church galleries, crypt, and towers.
   Release the enabled placement and target the managed survival flag for the intended players.
7. Verify both maps together: joining, pursuit, crafting, teammate revival, boss casts, and inventory restoration.
   [Arena startup](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/the-storm/plugin/modules/arena/src/main/java/com/shepherdjerred/thestorm/arena/adapter/paper/ArenaPaper.java) keeps admission closed when the authored map is missing or changed.

For an offline map build, copy only reviewed region changes while the destination server is stopped.
Compare the original region hashes first and keep the originals for restoration.
Do not replace level metadata, inventories, or plugin databases with disposable test fixtures.

## Move an existing arena

Build the authored map in a disposable copy of the local world using the exact plugin and
configuration intended for release. Check the map from above and at street level, then run
the native arena tests against that copy before changing the live world.

Use the configured world and footprint for each map. The blueprint preserves its
authored layout under translation, including negative chunk boundaries and floor patterns, through [SurvivalPlacement](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/the-storm/plugin/modules/arena/src/main/java/com/shepherdjerred/thestorm/arena/domain/survival/SurvivalPlacement.java).
For the move from the main world, Settlement translates X by −1792 and Z by −2208;
Rustworks translates X by −2016 and Z by −2212. Height stays unchanged.
Copy permanent geometry and block entities after draining runs and resetting temporary
fixtures. Preserve character progression, saved inventories, and all plugin databases.

1. Inspect the current image, admission settings, ArgoCD application policy, and online players.
   Prepare the matching code artifact before starting maintenance.
2. Drain both arenas with `/arena stop <id>` and verify that no players remain in the affected regions.
   Complete a scoped volume backup and create a consistent SQLite backup. Check its integrity.
   Capture both source regions through the [live harness](/how-to/operate-the-storm-with-the-agent-harness/).
3. Create and persist the two named worlds. Preserve the source world's difficulty.
   Use the bridge's [native WorldEdit command path](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/the-storm/plugin/bridge/src/main/java/com/shepherdjerred/mcbridge/adapter/worldedit/WorldEditService.java) with one session for copy and paste, with `//perf neighbors off`.
   Keep lighting and event side effects enabled; ensure validation side effects are off.
4. Copy each source region with native `//copy`, placing the actor at the region's minimum corner.
   Paste with native `//paste` at the translated minimum corner in the destination world.
   Supply the exact destination bounds through the harness's [`--affects` guard](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/mc-harness/src/live/guard.ts).
   Use a reason and the protected-region override for each live write.
   Avoid the generic schematic paste API, which recomputes adjacent wall and fence states.
5. Capture each destination and compare every block state and translated block entity with its source.
   Restore temporary doors or fixtures to the reviewed blueprint and record each repair separately.
   Keep both original sites intact while accepting the new worlds.
6. Prepare a safe exit platform and lobby spawn in each new world.
   Release the matching plugin, survival content, and arena configuration through GitOps.
   Preserve the application's reconciliation policy and use a narrowly scoped application sync.
7. Verify plugin startup, admission, artifact identity, and map comparisons for both arenas.
   Check joining, fighting, leaving, and inventory restoration with a native player.
   A healthy rollout does not replace a player gameplay check.

## Use an offline region merge

If native WorldEdit cannot preserve the reviewed map, merge only its bounded cells while Paper is stopped.
On Paper 26.2, named dimensions share the enclosing world save and its `session.lock`.
The pinned Paper [world creation and unloading implementation](https://github.com/PaperMC/Paper/blob/9240f58/paper-server/src/main/java/org/bukkit/craftbukkit/CraftServer.java) uses the server's shared storage.
Unloading one arena world closes its chunk source without releasing that shared storage.
Use the repository's [save-lock check](https://github.com/shepherdjerred/monorepo/blob/6a4c401a03c7e9ba9fdebf16ec16abe0972a895b/packages/the-storm/server/archive-progression.py) before an offline merge.

1. Stop Paper cleanly and verify that no process holds the save's `session.lock`.
2. Archive the original region files and keep the original settlement archive unchanged.
3. Merge permanent geometry and translated block entities into the destination chunks.
   Preserve outside blocks, block entities, biomes, ticks, and unchanged chunk records.
   Invalidate lighting and heightmaps only for changed chunks.
4. Compare source hashes again while holding the save lock.
   Write temporary sibling files, verify their hashes, and atomically replace the reviewed regions.
5. Restart Paper and capture the destination through MCBridge.
   Compare every block state and block entity before releasing arena admission.

Update the working local map using the same bounded merge. Retain the source region, release
artifact identity, configuration hashes, and installation receipt so restoration is explicit.

## Restore the site

Disable the placement through the repository release path.
Run `/settlement restore <backup-token>` for an online provisioned placement,
or merge the exact original cells with the server stopped for an offline placement.
For relocated arenas, first accept both new worlds through the native player flow.
Then use verified pre-build archives to restore only the original map footprints and
historical exit cells in the main world. Preserve every block, block entity, biome,
and pending tick outside those cells, even inside a changed chunk. Compare unaffected
chunk records byte for byte, and invalidate lighting and heightmaps in changed chunks.
Stop restoration when archive coverage or an intervening edit is uncertain; retain
the old site and its protection until a verified restoration source is available.
The online restore refuses changed ownership, foreign footprints, and conflicting block edits.
It can resume a partially applied backup.

## Related

- [The Storm gameplay and command reference](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/README.md)
- [Arena module wiring](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/plugin/modules/arena/src/main/java/com/shepherdjerred/thestorm/arena/ArenaModule.java)
