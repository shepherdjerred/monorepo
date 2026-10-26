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
  `minecraft-tsmc` and port-forward to `minecraft-tsmc-0`;
- a tsmc image with MCBridge on port 25580, which reads `MC_BRIDGE_TOKEN` from
  the `storm-brain` 1Password item.

1. Check the harness identity:

   ```bash
   AS=--as=system:serviceaccount:mc-sandbox:mc-harness
   kubectl --context admin@torvalds -n minecraft-tsmc $AS auth can-i get statefulset/minecraft-tsmc
   kubectl --context admin@torvalds -n minecraft-tsmc $AS auth can-i get pod/minecraft-tsmc-0
   kubectl --context admin@torvalds -n minecraft-tsmc $AS auth can-i create pod/minecraft-tsmc-0 --subresource=portforward
   kubectl --context admin@torvalds -n minecraft-tsmc $AS auth can-i patch statefulset/minecraft-tsmc
   ```

   The first three must print `yes` and the last `no`: the harness can never
   change replicas or annotations.

2. Start the daemon with the bridge token from the repository root. The token
   stays in the daemon's environment; the harness never prints, logs or
   journals it.

   ```bash
   toolkit mc daemon stop
   scripts/onepassword/with-service-account.sh sh -c \
     'MC_BRIDGE_TOKEN="$(op read "op://v64ocnykdqju4ui6j6pua56xw4/mpv7cti3fpwrfobgr6ydnemydy/MC_BRIDGE_TOKEN")" && export MC_BRIDGE_TOKEN && unset OP_SERVICE_ACCOUNT_TOKEN && exec toolkit mc daemon start'
   ```

   The [service-account wrapper](https://github.com/shepherdjerred/monorepo/blob/main/scripts/onepassword/with-service-account.sh)
   reads the Keychain-enrolled 1Password service account, so no desktop
   approval is needed. The command unsets that token before the daemon starts,
   so the daemon holds only the bridge token. The reference uses the vault and
   item ids because `op://` rejects the parentheses in the vault name.

3. Check the server:

   ```bash
   toolkit mc live status
   ```

   It refuses while tsmc is asleep (scaled to zero) or not ready. For ordinary sleep,
   join `ts-mc.net` so mc-router wakes the server. The harness never changes replicas or router annotations.

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

| Write                                                                       | Tier | Needs                                    |
| --------------------------------------------------------------------------- | ---- | ---------------------------------------- |
| Console command, actor move, spawn or chat                                  | 0    | `--reason`                               |
| WorldEdit, paste, snapshot restore, actor `break`/`place`/`use`             | 1    | `--reason`; the box is snapshotted first |
| Region over 1,000,000 blocks                                                | 2    | `--reason`                               |
| `stop`, `kill`, `op`, `whitelist off`, `co rollback`, `//regen` and similar | 2    | also `--confirm-dangerous`               |

The guard refuses outright:

- console block commands such as `fill`, `setblock` and `clone` (use `we` or
  `paste` so the change can be undone);
- any world outside `mcLiveWorlds`;
- regions over the snapshot limit;
- any write while a human player stands inside the box;
- block writes intersecting a protected region (`mcLiveProtectedRegions`, by
  default the Zombies settlement in `world`, x 1712-1871, z 2128-2287) unless
  you pass `--allow-protected`.

A human within 32 blocks needs `--allow-players`. Citizens NPCs never count.
WorldEdit shapes that reach beyond the selection, such as `//sphere`, need
`--affects x1,y1,z1:x2,y2,z2`.

Scheduled Velero backups cover the world volume. The harness does not take
its own backup, and a tier-2 write does not wait for one. Dangerous commands
still need `--confirm-dangerous`.

Set `mcLiveWrites = false` in `~/.toolkit/config.toml` to refuse every live
write. `mcLiveWorlds`, `mcLiveMaxRegionVolume`, `mcLiveNearPlayerRadius` and
`mcLiveProtectedRegions` tune the other limits.

## If a live call fails

- **412 with a start hint:** the daemon started without `MC_BRIDGE_TOKEN`.
  Restart it as in step 2.
- **409 asleep:** ask the user to join so the router wakes the server.
- **502 bridge health check:** the running image predates MCBridge or the token
  does not match `storm-brain`.
- **403 `live write refused`:** the message names the missing flag or the player
  in the way.

## Related

- [Run a Minecraft sandbox in the cluster](/how-to/run-a-minecraft-sandbox-in-the-cluster/) to rehearse a change first
- [Prepare The Storm companion RCON access](/how-to/prepare-the-storm-companion-rcon/) for the other 1Password-backed server credential
