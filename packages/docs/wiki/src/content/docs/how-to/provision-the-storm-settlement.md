---
title: How to provision The Storm settlement
description: Prepare, inspect, apply, and recover the authored survival settlement without overwriting existing builds.
---

Provision the settlement with admission disabled, then activate it through the repository release path.

1. Set `enabled: false` in `arena/survival.yml` and `arena/rustworks.yml`, then release that configuration.
   Keep the authored footprint and blueprint in the reviewed repository revision.
2. Create separate NORMAL superflat void worlds named `settlement` and `rustworks` through Multiverse.
   Use one air layer, the void biome, and no generated structures. Rehearse the pinned
   Multiverse command syntax in a disposable server before using it live.
   Persist both worlds in Multiverse's runtime catalog so they load before The Storm.
   Set each world spawn to its configured arena lobby after installing its safe platform.
   Set both worlds to NORMAL difficulty so native hostile spawns are permitted.
   Keep arena worlds outside the resource-world and random-teleport registry.
3. Inspect the selected site in a local world copy and check current claims.
   Keep an immutable copy of the original region files.
4. Run `/settlement preview` as an administrator. The preview checks ownership,
   existing blocks, and the exact bounded footprint. Resolve every reported conflict.
5. Inspect the placement and run `/settlement apply <preview-token>`.
   The immutable database backup commits before the first block changes.
   Wait for the `APPLIED` result and retain its token.
6. Repeat the preview and apply procedure with `/rustworks` for its own world.
   Inspect buildings, rising streets, entrances, crafting stations, the church galleries, crypt, and towers.
   Release the enabled placement and target the managed survival flag for the intended players.
7. Verify both maps together: joining, pursuit, crafting, teammate revival, boss casts, and inventory restoration.
   Startup keeps admission closed when the authored map is missing or changed.

For an offline map build, copy only reviewed region changes while the destination server is stopped.
Compare the original region hashes first and keep the originals for restoration.
Do not replace level metadata, inventories, or plugin databases with disposable test fixtures.

## Move an existing arena offline

Build the authored map in a disposable copy of the local world using the exact plugin and
configuration intended for release. Check the map from above and at street level, then run
the native arena tests against that copy before changing the live world.

Use the configured world and footprint for each map. The blueprint preserves its
authored layout under translation, including negative chunk boundaries and floor patterns.
For the move from the main world, Settlement translates X by −1792 and Z by −2208;
Rustworks translates X by −2016 and Z by −2212. Height stays unchanged.
Copy permanent geometry and block entities after draining runs and resetting temporary
fixtures. Preserve character progression, saved inventories, and all plugin databases.

1. Inspect the current image, admission settings, ArgoCD application policy, and online players.
   Prepare the matching code artifact before starting maintenance.
2. Stop Paper cleanly and verify that no process holds the world's `session.lock`.
3. Archive the current region and create a SQLite backup of The Storm's database. Check the
   database backup's integrity. Keep the original settlement archive unchanged.
4. Prepare each named arena world from the reviewed geometry. Record source and
   destination hashes and validate every permanent block against the released blueprint.
   Translate block-entity coordinates and invalidate lighting and heightmaps for changed chunks.
5. Verify the live source hash again while holding the world lock. Transfer the merged region
   to a temporary sibling file, verify its hash, and atomically replace the region.
6. Restart with the matching plugin, survival content, and arena configuration. Preserve the
   application's existing reconciliation policy and use a narrowly scoped application sync.
7. Verify plugin startup, settlement admission, the deployed artifact and map hashes, and the
   arena commands. A healthy rollout does not replace a player gameplay check.

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
