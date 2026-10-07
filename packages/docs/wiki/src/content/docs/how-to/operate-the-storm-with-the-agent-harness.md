---
title: Operate The Storm with the agent harness
description: Point toolkit mc at live minecraft-tsmc to run guarded commands, builds and undos, with every write journaled.
---

Use `--target live` when an agent should change the real server: promote a
build, run a console command, or move an actor. The harness reaches tsmc's
MCBridge through a `kubectl port-forward` as the `mc-sandbox:mc-harness`
ServiceAccount. Every live write needs a reason, passes a guard and is journaled.
The "Live minecraft-tsmc" section of the
[mc-harness README](https://github.com/shepherdjerred/monorepo/blob/main/packages/mc-harness/README.md#live-minecraft-tsmc) explains
how the guard decides.

Before you start, you need:

- the `admin@torvalds` kube context (or `MC_KUBE_CONTEXT`), which can
  impersonate `mc-sandbox:mc-harness`;
- the homelab release that grants that ServiceAccount read access to
  `minecraft-tsmc`, port-forward to `minecraft-tsmc-0`, and Velero backup
  create/read;
- a tsmc image with MCBridge on port 25580, which reads `MC_BRIDGE_TOKEN` from
  the `storm-brain` 1Password item.

1. Check the harness identity:

   ```bash
   AS=--as=system:serviceaccount:mc-sandbox:mc-harness
   kubectl --context admin@torvalds -n minecraft-tsmc $AS auth can-i get statefulset/minecraft-tsmc
   kubectl --context admin@torvalds -n minecraft-tsmc $AS auth can-i get pod/minecraft-tsmc-0
   kubectl --context admin@torvalds -n minecraft-tsmc $AS auth can-i create pod/minecraft-tsmc-0 --subresource=portforward
   kubectl --context admin@torvalds -n velero $AS auth can-i create backups.velero.io
   kubectl --context admin@torvalds -n minecraft-tsmc $AS auth can-i patch statefulset/minecraft-tsmc
   ```

   The first four must print `yes` and the last `no`: the harness can never
   change replicas or annotations.

2. Start the daemon with the bridge token. The token stays in the daemon's
   environment; the harness never prints, logs or journals it.

   ```bash
   toolkit mc daemon stop
   MC_BRIDGE_TOKEN=$(op read 'op://v64ocnykdqju4ui6j6pua56xw4/mpv7cti3fpwrfobgr6ydnemydy/MC_BRIDGE_TOKEN') \
     toolkit mc daemon start
   ```

   The reference uses the vault and item ids because `op://` rejects the
   parentheses in the vault name.

3. Check the server:

   ```bash
   toolkit mc live status
   ```

   Inspect the reported restoration lease before starting a live operation.
   While restoration holds the lease, await its operator even if a private
   acceptance server is running. Public routes stay closed during that phase.
   The harness refuses ordinary live access throughout restoration.

   It also refuses while tsmc is asleep (scaled to zero) or while the mining
   reset holds its lock. For ordinary sleep, join `ts-mc.net` so mc-router wakes
   the server. The harness never changes replicas or router annotations.

4. After the live guard accepts the target, run reads and writes with
   `--target live`. Writes need `--reason`:

   ```bash
   toolkit mc cmd --target live list
   toolkit mc cmd --target live --reason "daylight for screenshots" time set noon
   toolkit mc build promote ./builds/gazebo --target live --reason "gazebo for the spawn garden"
   ```

   Run `build promote` once without `--confirm` to see the plan, then again
   with the printed hash.

5. Undo a write by its journal id. Undo restores the snapshot taken before the
   write, newest first:

   ```bash
   toolkit mc live journal --since 1d
   toolkit mc live undo lj-mf3k2a-1b2c3d --reason "owner preferred the old path"
   ```

   For a promoted build, `toolkit mc build undo <apply-id> --reason "<why>"`
   also works.

## What the guard asks for

| Write                                                                       | Tier | Needs                                       |
| --------------------------------------------------------------------------- | ---- | ------------------------------------------- |
| Console command, actor move, spawn or chat                                  | 0    | `--reason`                                  |
| WorldEdit, paste, snapshot restore, actor `break`/`place`/`use`             | 1    | `--reason`; the box is snapshotted first    |
| Region over 1,000,000 blocks                                                | 2    | also a Velero backup from the last 24 hours |
| `stop`, `kill`, `op`, `whitelist off`, `co rollback`, `//regen` and similar | 2    | also `--confirm-dangerous`                  |

The guard refuses outright:

- console block commands such as `fill`, `setblock` and `clone` (use `we` or
  `paste` so the change can be undone);
- the `mining` world and any world outside `mcLiveWorlds`;
- regions over the snapshot limit;
- any write while a human player stands inside the box;
- block writes intersecting a protected region (`mcLiveProtectedRegions`, by
  default the Zombies settlement in `world`, x 1712-1871, z 2128-2287) unless
  you pass `--allow-protected`.

A human within 32 blocks needs `--allow-players`. Citizens NPCs never count.
WorldEdit shapes that reach beyond the selection, such as `//sphere`, need
`--affects x1,y1,z1:x2,y2,z2`.

Take a backup before a tier-2 write. The six-hourly scheduled backups also
count when they are recent:

```bash
toolkit mc live backup --wait --reason "before regenerating the north field"
```

Set `mcLiveWrites = false` in `~/.toolkit/config.toml` to refuse every live
write. `mcLiveWorlds`, `mcLiveMaxRegionVolume`, `mcLiveBackupMaxAgeHours`,
`mcLiveNearPlayerRadius` and `mcLiveProtectedRegions` tune the other limits.

## If a live call fails

- **412 with an `op read` hint:** the daemon started without `MC_BRIDGE_TOKEN`.
  Restart it as in step 2.
- **409 asleep:** ask the user to join so the router wakes the server.
- **409 mining reset:** await the reset operator. See
  [Recover The Storm mining reset](/how-to/recover-the-storm-mining-reset/) for
  a held lock.
- **409 world restoration:** await the restoration operator. A running private
  acceptance server does not permit ordinary harness access or public joins.
- **502 bridge health check:** the running image predates MCBridge or the token
  does not match `storm-brain`.
- **403 `live write refused`:** the message names the missing flag, the player
  in the way, or the backup to take.

## Related

- [Run a Minecraft sandbox in the cluster](/how-to/run-a-minecraft-sandbox-in-the-cluster/) to rehearse a change first
- [Prepare The Storm companion RCON access](/how-to/prepare-the-storm-companion-rcon/) for the other 1Password-backed server credential
