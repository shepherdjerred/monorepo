---
title: Change The Storm's world borders
description: Resize circular worlds, preserve player state, verify rollback storage, pregenerate chunks, and update existing BlueMap renders.
---

Change world borders through the owned image, with stopped maintenance for saved-player relocation and world retirement.

## 1. Prepare the image

Update [`world.yml`](packages/the-storm/server/owned/plugins/TheStorm/world.yml)
and the matching [`BlueMap masks`](packages/the-storm/server/owned/plugins/BlueMap/maps/).
World border sizes are **diameters**; BlueMap and Chunky use **radii**.
Keep every center at `(0, 0)`.

For Creative, also update
[`creative.yml`](packages/the-storm/server/owned/plugins/TheStorm/creative.yml).
The full plot footprint must fit inside the circle for claims, homes, and markers.
Keep the recovered plot catalog and saved terrain outside the circle.

Remove retired worlds from travel, towns, mobs, and map configuration.
Keep historical quest IDs stable so existing progress survives.
Build the candidate and run the focused domain, Paper, maintenance, and gameplay checks before publication.
The image refuses an existing volume without completed world retirement before syncing owned configuration.

## 2. Separate map storage before backing up worlds

BlueMap's cache lives on `minecraft-tsmc-bluemap`, mounted at `/data/bluemap`.
The world claim remains `datadir-minecraft-tsmc-0`.
The [server construct](packages/homelab/src/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.ts)
and [backup policy](packages/homelab/src/cdk8s/src/backup-policy/pvc-backup-policy.json)
declare these separately.

Deploy storage changes through the [homelab release path](/how-to/cut-a-homelab-release/).
Wait for the init copy's `VERIFIED` receipt, then inspect every existing map in the browser.
Verify separate mounted filesystems and that only the world claim is backed up.

Retire the original cache through `retire-bluemap-source` in
[`restoration-control.py`](packages/the-storm/server/restoration-control.py).
Its evidence identifies the request, unchanged production image, cache PVC UID, copied manifest, rendered maps, and verified storage checks.
Use the existing acquire, private acceptance, graceful stop, and release operations.
The source cache remains intact until this explicit acceptance.

## 3. Verify an independent world restore

Use the controller's `acquire`, `backup`, `restore-backup`, and `verify-backup` operations.
Run them under one request UUID and journal, with the exact published candidate image.
Stop if the server is occupied.

Require `byteVerification: VERIFIED` for the independent restored volume.
Remove its readers before creating a writer.
Use `select-maintenance-candidate` to bind the published image after backup verification, before any writer authorization.
Preserve earlier restoration archives and existing backup retention.
The [backup contract](packages/the-storm/server/restoration_backup.py)
includes every retained native dimension.

## 4. Retire Wilds and Peaks safely

Capture clear recovery sites near main spawn with the
[agent harness](/how-to/operate-the-storm-with-the-agent-harness/).
Each grave needs a distinct site with two air blocks above solid ground.
The evidence file contains `region`, the complete MCBridge region response, and `sites`, its chosen `{ world, x, y, z }` entries.

Compile the reviewed `NativePlayerRetirement.java`
from the [conversion tools](packages/the-storm/server/conversion/)
against the candidate's Paper libraries and retain its class in an independent staging directory.
Then run from the repository root:

```bash
python3 packages/the-storm/server/restoration-control.py retire-worlds \
  --journal JOURNAL --request REQUEST_UUID --image PUBLISHED_IMAGE \
  --staging NATIVE_CLASSES --candidate PUBLISHED_THE_STORM_JAR \
  --evidence RECOVERY_SITES_JSON
```

The [maintenance controller](packages/the-storm/server/restoration-control.py)
requires the exact restored-backup proof and an offline, request-owned writer.
It relocates saved players and destinations, preserves item bytes and durable claims, and notifies grave owners.
Moved graves restart their configured protection and expiration so loading their recovery sites cannot immediately drop old items.
Saved death handoffs and pending item drops must reconcile before retirement.
Only the two retired dimensions and their affected generation tasks are removed.
Every unrelated world, identity, progression row, and restoration archive must match its original fingerprint.

Remove the writer, start the candidate privately, and verify the controller's circular-world acceptance checks.
Check safe spawns, boundary movement and teleports, Creative inventory isolation, recovered graves, and every retained world.
Record acceptance for the exact pod incarnation, stop gracefully, and release through the existing controller.
The retirement marker prevents historical resource bootstrap from recreating Wilds and Peaks.

## 5. Generate and render

Run one Chunky task at a time through the harness, with a reason and the verified backup:

```text
chunky start frontier circle 0 0 7000
chunky progress frontier
```

Use each world's configured radius, including Nether, End, Skylands, and Creative.
Require completion before starting the next task.
Cancel completed task records through Chunky without trimming retained terrain.
Its [command reference](https://github.com/pop4959/Chunky/wiki/Commands)
distinguishes task cancellation from chunk deletion.

Preserve existing BlueMap storage and request incremental updates for generated chunks.
Changed [render masks](https://bluemap.bluecolored.de/wiki/customization/Masks.html)
automatically update visibility and remove tiles outside the new masks.
Use `bluemap fix-edges MAP_ID` for changed boundaries.
Require an empty render queue and inspect all maps before reporting completion.

Measure the world claim and render claim separately after generation.
Backup size excludes the render claim; old backups retain their original contents until normal expiration.

## Related

- [Add a world to The Storm](/how-to/add-a-world-to-the-storm/)
- [Operate The Storm with the agent harness](/how-to/operate-the-storm-with-the-agent-harness/)
