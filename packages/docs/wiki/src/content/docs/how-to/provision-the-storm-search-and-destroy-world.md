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
/mv create <world> normal --world-type flat --no-structures --generator-settings {"layers":[{"block":"minecraft:air","height":1}],"biome":"minecraft:the_void"}
```

The flat type and the `--no-structures` flag are documented by Multiverse.
The `--generator-settings` payload is the vanilla superflat JSON that the
e2e fixture plugin creates the test world with: one air layer in the
`the_void` biome. It has not been run through Multiverse's argument parser on
this server, so confirm the created world has no terrain before continuing.

Do not pass `--generator`. No void generator plugin is baked into the image,
and The Storm deliberately ships none: Multiverse loads its worlds before
The Storm enables, and Bukkit refuses a generator whose plugin is not yet
enabled, so the world would fail to load on every later boot. For the same
reason the world is not listed in `world.yml`; the `rwf` module checks and
seals it itself.

## 2. Create the recording salt

Match recordings pseudonymise players with an HMAC over a salt that the server
reads from `RWF_RECORDING_SALT`; `rwf` refuses to enable without it while
recording is on.
[The chart](packages/homelab/src/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.ts)
already declares a `OnePasswordItem` named `minecraft-tsmc-rwf-recording` and
the `RWF_RECORDING_SALT` `extraEnv` entry that reads it. Only the 1Password
item is left to create.

1. In the Homelab (Kubernetes) vault, create an item titled
   `the-storm-rwf-recording` with one concealed field labelled
   `RWF_RECORDING_SALT`. Generate the value in 1Password (32 or more random
   characters) and never copy it into Git, a terminal, or chat. Keep it a
   separate item: the chart projects it only into the `minecraft-tsmc`
   namespace, while `storm-brain` is also projected into the agent's.
2. Refresh the hash-only vault snapshot and run the offline reference check
   from `packages/homelab/src/cdk8s`:

   ```bash
   bun run scripts/snapshot-1password-vault.ts
   bun run check:1password
   ```

   Until the item exists, `check:1password` fails with
   `1Password item not found in vault: "the-storm-rwf-recording"`, and the
   pod cannot start because its Secret is missing. Commit the refreshed
   snapshot before the chart change is released.

Changing the salt later re-keys every pseudonym, so recordings made before and
after the change no longer link the same player.

## 3. Ship the map

Place each map under
`server/owned/plugins/TheStorm/rwf/maps/<id>/` with two files: `map.yml`
(teams, spawns, bomb sites and rules) and `blocks.schem` (the terrain). The
`<id>` is the map id that recordings name, so keep it stable once a map has
been played. The image delivers the whole owned directory on every boot, so
nothing is copied to the volume by hand.

The lobby room ships the same way from
`server/owned/plugins/TheStorm/rwf/lobby/` (`lobby.yml`, `blocks.schem` and its
nav files). It is generated, so there is nothing to build by hand: the module
pastes it at `128,64,16` in the same world, east of the maps, and keeps that
area free of maps. Place new maps so their regions do not overlap it; the
module refuses to enable if one does.

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
2. Join as a human with `/rwf join`. You must land on the gold spawn pad of
   the lobby room, with the rules, the match board and four kit alcoves
   around you and a countdown bar at the top of the screen. The lobby must
   fill with bots and start a round with you as the only person.
3. Watch the pod while the round runs. The chart requests 3 CPU (sized from
   the rwfbots load profile) and limits memory to 10 Gi; CPU above the
   request is burst, and memory must stay inside the limit:

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
