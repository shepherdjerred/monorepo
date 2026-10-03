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

## Restore the site

Disable the placement through the repository release path.
Run `/settlement restore <backup-token>` for an online provisioned placement,
or restore the original region files with the server stopped for an offline placement.
The online restore refuses changed ownership, foreign footprints, and conflicting block edits.
It can resume a partially applied backup.

## Related

- [The Storm gameplay and command reference](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/README.md)
- [Arena module wiring](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/plugin/modules/arena/src/main/java/com/shepherdjerred/thestorm/arena/ArenaModule.java)
