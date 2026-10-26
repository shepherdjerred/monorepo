---
title: Change The Storm's world borders
description: Resize circular worlds, relocate saved players offline, pregenerate chunks, and update existing BlueMap renders.
---

Change borders through the owned image and run saved-state maintenance against the stopped world volume before activating it.

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
Run the focused domain, Paper, maintenance, and gameplay checks before publication.
The image refuses existing data without completed world retirement before syncing configuration.

## 2. Separate map storage

BlueMap's cache lives on `minecraft-tsmc-bluemap`, mounted at `/data/bluemap`.
The world claim remains `datadir-minecraft-tsmc-0`.
The [server construct](packages/homelab/src/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.ts)
and [backup policy](packages/homelab/src/cdk8s/src/backup-policy/pvc-backup-policy.json)
declare these separately.
The Minecraft child chart owns the cache claim and migration ConfigMap through
`extraDeploy`, alongside the init container that verifies the copy.

Deploy storage changes through the [homelab release path](/how-to/cut-a-homelab-release/), keeping the accepted server image.
Wait for the init copy's `VERIFIED` receipt, then inspect every existing map in the browser.
Verify separate mounted filesystems and that the render claim is excluded from scheduled Velero backups.
Keep existing backup retention unchanged. These maintenance scripts do not create backups or restore volumes.

Once the copied maps are accepted, run the reviewed storage asset against the two stopped, independent mounts:

```bash
python3 bluemap_storage.py retire-source --data /data --destination /cache \
  --accepted-manifest COPIED_MANIFEST_SHA256
```

The asset requires the accepted copy manifest and removes only original cache entries.
It preserves later renders on the new volume and never selects world files.

## 3. Seal offline world maintenance

Keep deployment requests held and arrange an authorized offline mount of the existing world claim.
Confirm Paper is stopped and the scheduled Velero backup policy remains healthy before deleting worlds.
The scripts require native world save locks; they do not stop the server, change routes, or control Delivery.
Do not run file inventory or database preparation alongside Paper.

Capture distinct grave recovery sites near main spawn with the
[agent harness](/how-to/operate-the-storm-with-the-agent-harness/).
Each site needs two air blocks above solid ground.
The evidence file contains `region`, the complete MCBridge response, and `sites`, its chosen `{ world, x, y, z }` entries.

Compile `conversion/NativePlayerRetirement.java` from the
[server tools](packages/the-storm/server/)
against the candidate's Paper libraries. Retain the class in an independent operator directory.
The helper accepts native 26.2 save data and preserves its data version; it does not upgrade inventories.

From `packages/the-storm/server`, seal the offline source, candidate plugin, helper, borders, and grave sites:

```bash
python3 -m maintenance.control --data /data --output /scratch/world-plan.json \
  --candidate /plugins/TheStorm.jar --native /operator/NativePlayerRetirement.class \
  --evidence /operator/recovery-sites.json --image PUBLISHED_IMAGE_WITH_DIGEST
```

Keep that plan outside the data volume. Inspect its source manifest and grave destinations before applying it.
The plan binds the source filesystem identity, exact artifact hashes, and configured circles.

## 4. Retire the worlds and activate

Run the same sealed plan from the candidate image with its published plugin and Paper libraries:

```bash
python3 -m maintenance.retire --data /data --plan /scratch/world-plan.json \
  --operator /operator
```

The transaction stages replacements and records a resumable journal under `.storm-maintenance`.
It relocates saved players and destinations, preserves item bytes and claim tokens, and notifies grave owners.
Moved graves restart protection and expiration. Saved death handoffs and pending item drops must reconcile before retirement.
Only Wilds, Peaks, and their affected generation tasks are deleted.
Every unrelated world, identity, progression row, and older archive must retain its original fingerprint.
Resume an interrupted apply with the same plan and artifacts; changed inputs are refused.

Release the offline mount, then activate through Delivery's retained-volume restart.
Verify safe spawns, boundary movement and teleports, Creative inventory isolation, graves, and every retained world.
The retirement marker must be complete before the candidate syncs its owned configuration.

## 5. Generate and render

Run one Chunky task at a time through the harness with a reason:

```text
chunky start frontier circle 0 0 7000
chunky progress frontier
```

Use each world's configured radius, including Nether, End, Skylands, and Creative.
Require completion before starting the next task.
The image enables `force-load-existing-chunks` so Paper also upgrades historical
chunks that it would otherwise skip. This preserves their terrain while making
the native saved format available to BlueMap; do not replace or trim old chunks
to repair a missing render.
The image bounds Chunky to four in-flight chunks and waits for their load
tickets to be removed, so a scan cannot accumulate unloaded work. Monitor
container memory and tick times while generating; pause the task if the server
cannot sustain the load.
Cancel completed task records through Chunky without trimming retained terrain.
Its [command reference](https://github.com/pop4959/Chunky/wiki/Commands)
distinguishes task cancellation from chunk deletion.

Preserve existing BlueMap storage and request incremental updates for generated chunks.
Changed [render masks](https://bluemap.bluecolored.de/wiki/customization/Masks.html)
update visibility and remove tiles outside the new masks.
Use `bluemap fix-edges MAP_ID` for changed boundaries.
Require an empty render queue and inspect all maps before reporting completion.

Measure world saves and render storage separately after generation.
Scheduled backups exclude the render claim; old backups retain their original contents until normal expiration.

## Related

- [Add a world to The Storm](/how-to/add-a-world-to-the-storm/)
- [Operate The Storm with the agent harness](/how-to/operate-the-storm-with-the-agent-harness/)
