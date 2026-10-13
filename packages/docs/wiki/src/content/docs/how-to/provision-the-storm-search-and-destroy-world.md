---
title: Provision The Storm's Search and Destroy worlds
description: Prepare the map world and owned lobby declaration, wire the recording salt, ship content, and verify the first bot-filled round.
---

Provision the Search and Destroy map world before starting The Storm's `rwf`
and `rwfbots` modules. RWF creates and loads its declared void lobby itself. Players see the result
described at
[docs.ts-mc.net/search-and-destroy](https://docs.ts-mc.net/search-and-destroy/).

Every repository step below ships through a pull request and the
[homelab release](/how-to/cut-a-homelab-release/) path. Only step 1 and the
final checks run against the live server.

## 1. Prepare the map world and declare the owned lobby

Read the `worlds` section of `server/owned/plugins/TheStorm/rwf.yml` under
[the owned plugin configuration](packages/the-storm/server/owned/plugins/TheStorm/):
`worlds.maps` names the existing map world; it must be loaded before RWF enables.
Keep an existing map world and its saved terrain. Create it with the command
below only when setting up a new installation.

Keep `worlds.lobbyProvisioning: owned-void` and a dedicated lowercase name in
`worlds.lobby`. At startup, RWF requires the map world first, seals the lobby
name, then asks Paper to create or load that lobby before starting gameplay.
An existing lobby keeps its world identity and saved terrain. RWF repairs only
the authored room. Do not add this lobby to Multiverse's runtime catalog or
overwrite that catalog with repository configuration.

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

Do not pass `--generator`. The flat settings require no generator plugin.
Keep both RWF worlds out of `world.yml`, which validates the separately restored
resource worlds. Multiverse continues loading the existing map world; RWF owns
the lobby's startup lifecycle.

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

The lobby ships the same way from
`server/owned/plugins/TheStorm/rwf/lobby/` (`lobby.yml`, `blocks.schem` and its
nav files). The module pastes it at `0,64,0` in the lobby world, so maps never
share its space. Maps share the map world, so place new maps so their regions
do not overlap one another; the module refuses to enable if two do.

## 4. Enable the modules

In [config.yml](packages/the-storm/server/owned/plugins/TheStorm/config.yml),
keep `rwf: true`, `rwfbots: true`, and their `economy` dependency enabled.
These modules already ship enabled. Merge the change and let the
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

The match experience has a flag per part, each declared in the same
inventory `false` by default with a `beta` override of `true`:
`the-storm-rwf-match-flow-enabled` (map vote, preview and freeze),
`the-storm-rwf-carry-over-enabled`, `the-storm-rwf-death-feed-enabled`,
`the-storm-rwf-team-chat-enabled`, `the-storm-rwf-spectator-tools-enabled`,
`the-storm-rwf-bomb-effects-enabled` and `the-storm-rwf-stats-enabled`. The
module reads them as each match opens, so a change reaches the next match.
Open them for production the same way, one override at a time.

Do not toggle a flag in the Flipt UI alone; the inventory reconciler
reports that as drift. The
[flag inventory guide](/how-to/check-flipt-flag-inventory/) covers the
command and its failure modes.

## 6. Verify the first round

1. Run `/rwf admin status` as an operator and confirm it reports the ready
   lobby, the playable maps, the match features read from the flags and zero
   humans. This guide was written from
   the module contract, not a live server, so if the command is missing,
   check the rwf command registration under
   [the plugin modules](packages/the-storm/plugin/modules/) for its current
   name.
2. Join as a human with `/rwf join`. You must land on the lobby's plaza in
   the lobby world, with the rules, the match board, the vote podiums, the
   leaderboards and a kit alcove per kit around you and a countdown bar at the
   top of the screen. The lobby must fill with bots and start a round with you
   as the only person. With the match flow flag on, the chosen map previews
   and everyone freezes at their start before the round begins.
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
