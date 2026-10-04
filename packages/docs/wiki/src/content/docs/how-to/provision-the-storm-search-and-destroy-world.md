---
title: Provision The Storm's Search and Destroy world
description: Create the sealed rwf world, wire its recording salt, ship a map, enable the modules and flag, and verify the first bot-filled round.
---

Provision the dedicated Search and Destroy world on `minecraft-tsmc` before
switching on The Storm's `rwf` and `rwfbots` modules. Players see the result
described at
[docs.ts-mc.net/search-and-destroy](https://docs.ts-mc.net/search-and-destroy/).

Every repository step below ships through a pull request and the
[homelab release](/how-to/cut-a-homelab-release/) path. Only step 1 and the
final checks run against the live server.

## 1. Create the void world

Read the `world` key in `server/owned/plugins/TheStorm/rwf.yml` under
[the owned plugin configuration](packages/the-storm/server/owned/plugins/TheStorm/)
and use that exact name below. The module looks the world up by that name;
a world with any other name is not the Search and Destroy world.

Create the world with the Multiverse-Core 5.8.0 that
[the image bakes in](packages/the-storm/server/plugins.json). The
[Multiverse 5 command reference](https://mvplugins.org/core/fundamentals/commands-usage/)
documents `--world-type flat`, `--no-structures` and `--generator-settings`:

```text
/mv create <world> normal --world-type flat --no-structures --generator-settings {"layers":[],"biome":"minecraft:the_void"}
```

The flat type and the `--no-structures` flag are documented by Multiverse.
The empty-layer `--generator-settings` payload is vanilla superflat JSON for
a void preset; it has not been run through Multiverse's argument parser on
this server, so confirm the created world has no terrain before continuing.
No void generator plugin is baked into the image, so a `--generator` flag
has nothing to point at.

## 2. Wire the recording salt

Match recordings pseudonymise players with a salt that the server reads from
`RWF_RECORDING_SALT`. Provision it the way
[the chart](packages/homelab/src/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.ts)
already injects `STORM_BRAIN_BEARER_TOKEN`: a 1Password item synced into a
Kubernetes Secret, then an `extraEnv` entry with `valueFrom.secretKeyRef`.

1. In the Homelab (Kubernetes) vault, add a concealed `RWF_RECORDING_SALT`
   field to a 1Password item that the chart projects only into the
   `minecraft-tsmc` namespace, or create a new item and declare a matching
   `OnePasswordItem` in the chart. Generate the value in 1Password and never
   copy it into Git, a terminal, or chat. Do not reuse the `storm-brain`
   item; the chart also projects that item into the agent's namespace.
2. Add `RWF_RECORDING_SALT` to the chart's `extraEnv`, mirroring the
   `STORM_BRAIN_BEARER_TOKEN` entry, and extend
   [the chart test](packages/homelab/src/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.test.ts)
   with the same expectation shape.
3. Refresh the hash-only vault snapshot and run the offline reference check
   from `packages/homelab/src/cdk8s`:

   ```bash
   bun run scripts/snapshot-1password-vault.ts
   bun run check:1password
   ```

   Commit the refreshed snapshot with the chart change.

## 3. Ship the map

Place each map under
`server/owned/plugins/TheStorm/rwf/maps/<id>/` with two files: `map.yml`
(teams, spawns, bomb sites and rules) and `blocks.schem` (the terrain). The
`<id>` is the map id that recordings name, so keep it stable once a map has
been played. The image delivers the whole owned directory on every boot, so
nothing is copied to the volume by hand.

## 4. Enable the modules

In [config.yml](packages/the-storm/server/owned/plugins/TheStorm/config.yml),
set `rwf: true` and `rwfbots: true`. Both keys already exist as `false`;
`rwf` depends on `economy`, which stays on. Merge the change and let the
release pipeline publish the image and ArgoCD roll `minecraft-tsmc`. The
StatefulSet hibernates at zero replicas, so the new revision takes effect on
the next wake.

## 5. Open the flag

`/rwf join` is gated by the Flipt flag `the-storm-rwf-enabled` in namespace
`the-storm`. The
[managed inventory](packages/feature-flags/src/managed-flag-inventory.json)
declares it `false` by default with a `beta` override of `true`, so beta is
already open once the inventory is reconciled.

To open production, add a `prod` override for the key in the same inventory
file and merge it. Then confirm Flipt matches:

```bash
bun run check-flipt-flag-inventory -- --environment prod --namespace the-storm
```

Do not toggle the flag in the Flipt UI alone; the inventory reconciler
reports that as drift. The
[flag inventory guide](/how-to/check-flipt-flag-inventory/) covers the
command and its failure modes.

## 6. Verify the first round

1. Run `/rwf admin status` as an operator and confirm it reports the loaded
   world, the map set and zero active matches. This guide was written from
   the module contract, not a live server, so if the command is missing,
   check the rwf command registration under
   [the plugin modules](packages/the-storm/plugin/modules/) for its current
   name.
2. Join as a human with `/rwf join`. The lobby must fill with bots and start
   a round with you as the only person.
3. Watch the pod while the round runs. The chart requests 4 CPU and limits
   memory to 10 Gi, so the server must stay inside both:

   ```bash
   kubectl -n minecraft-tsmc top pod minecraft-tsmc-0
   ```

4. Leave with `/rwf leave` and confirm your survival inventory, XP, health
   and effects came back.

## Related

- [Cut a homelab release](/how-to/cut-a-homelab-release/)
- [Check the Flipt flag inventory](/how-to/check-flipt-flag-inventory/)
- [Prepare The Storm companion RCON access](/how-to/prepare-the-storm-companion-rcon/)
  for the same 1Password snapshot and check sequence
