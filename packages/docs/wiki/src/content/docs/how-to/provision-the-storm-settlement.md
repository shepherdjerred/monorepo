---
title: How to provision The Storm settlement
description: Prepare, inspect, apply, and recover the authored survival settlement without overwriting existing builds.
---

Provision the settlement with admission disabled, then activate it through the repository release path.

1. Set `enabled: false` in `arena/survival.yml` and release that configuration.
   Keep the authored footprint and blueprint in the reviewed repository revision.
2. Inspect the selected site in a local world copy and check current claims.
   Keep an immutable copy of the original region files.
3. Run `/settlement preview` as an administrator. The preview checks ownership,
   existing blocks, and the exact bounded footprint. Resolve every reported conflict.
4. Inspect the placement and run `/settlement apply <preview-token>`.
   The immutable database backup commits before the first block changes.
   Wait for the `APPLIED` result and retain its token.
5. Inspect buildings, cross routes, entrances, crafting stations, the mine, and towers.
   Release the enabled placement and target the managed survival flag for the intended players.
6. Verify joining, pursuit, crafting, teammate revival, boss casts, and inventory restoration.
   Startup keeps admission closed when the authored map is missing or changed.

For an offline map build, copy only reviewed region changes while the destination server is stopped.
Compare the original region hashes first and keep the originals for restoration.
Do not replace level metadata, inventories, or plugin databases with disposable test fixtures.

## Replace an existing settlement offline

Build the authored map in a disposable copy of the local world using the exact plugin and
configuration intended for release. Check the map from above and at street level, then run
the native arena tests against that copy before changing the live world.

The coastal fortress occupies the 100 chunks at chunk X 107–116 and Z 133–142. Its exit
adds chunk 106,133. All 101 records are in overworld region `r.3.4.mca`. Merge those records
into a fresh copy of the stopped server's region file; compare every remaining record byte
for byte with that fresh copy. Do not copy the entire region from the disposable world.

1. Inspect the current image, admission settings, ArgoCD application policy, and online players.
   Prepare the matching code artifact before starting maintenance.
2. Stop Paper cleanly and verify that no process holds the world's `session.lock`.
3. Archive the current region and create a SQLite backup of The Storm's database. Check the
   database backup's integrity. Keep the original settlement archive unchanged.
4. Merge the 101 reviewed chunk records. Record the source and merged SHA-256 hashes and
   verify that all 923 other records retain their original bytes.
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
or restore the original region files with the server stopped for an offline placement.
The online restore refuses changed ownership, foreign footprints, and conflicting block edits.
It can resume a partially applied backup.

## Related

- [The Storm gameplay and command reference](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/README.md)
- [Arena module wiring](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/plugin/modules/arena/src/main/java/com/shepherdjerred/thestorm/arena/ArenaModule.java)
