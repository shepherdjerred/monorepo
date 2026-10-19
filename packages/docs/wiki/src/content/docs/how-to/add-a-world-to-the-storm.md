---
title: Add a world to The Storm
description: Provision a survival world, declare it in the owned configuration, pregenerate it, and put it on BlueMap and the spawn travel hub.
---

Add a permanent survival world to The Storm. The world must exist on the live
server before the image that lists it ships, because the `world` module stops
startup when a world declared in `world.yml` is not loaded.

Every repository step ships through a pull request and the
[homelab release](/how-to/cut-a-homelab-release/) path. Run live commands
through the [agent harness](/how-to/operate-the-storm-with-the-agent-harness/),
each with a `--reason`.

## 1. Create the world on the live server

Create a Multiverse world for a vanilla preset (`normal`, `large_biomes` or
`amplified`):

```text
/mv create <name> normal
```

A world that needs a custom generator is not a Multiverse world. Multiverse
loads its worlds before TheStorm enables, and Paper refuses a generator from a
plugin that has not enabled yet. TheStorm's own module creates such a world
during enable, as the `skylands` module does. Skip this step for that kind of
world.

## 2. Declare it in the owned configuration

All files are under
[`server/owned/plugins/TheStorm/`](packages/the-storm/server/owned/plugins/TheStorm/).

| File                          | Change                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `world.yml` `worlds`          | Add `{ name, preset, rtp }`. The first entry is the default `/rtp` landing, so keep `frontier` first.                |
| `world.yml` `borders`         | Add the diameter and `shape`: `square` (native) or `circle` (native square plus the disc the world module enforces). |
| `rtp.yml` `withinBorder`      | Add the world only if settled or heritage land fills it up to its border.                                            |
| `towns.yml` `claims.worlds`   | Add it if towns may claim there.                                                                                     |
| `mobs.yml` `levelling.worlds` | Add it, or its mobs never level.                                                                                     |
| `shards.yml` `drops.worlds`   | Add its world key (`minecraft:<name>`) if Storm Shards drop there.                                                   |
| `travel.yml` `destinations`   | Add it to reach it from `/worlds` and the spawn hub.                                                                 |

Add `server/owned/plugins/BlueMap/maps/<name>.conf`, copied from a world of
the same kind. `plugins/BlueMap/maps` is an owned root: the image removes any
map the repository does not ship.

## 3. Pregenerate a bordered world

Set the border before starting, so Chunky stops at it. Use `/chunky shape circle`
for a circular border:

```text
/worldborder set <diameter>
/chunky world <name>
/chunky shape square
/chunky radius <diameter / 2>
/chunky start
```

Chunky resumes after a restart (`continue-on-restart`). Check free space on
`datadir-minecraft-tsmc-0` first; a 7000-block square is about 191,000 chunks.
When `/chunky progress` reports 100%, add
`plugins/Chunky/tasks/<name>.properties` to
[`server/remove.list`](packages/the-storm/server/remove.list) so a finished
task never re-queues.

## 4. Add it to the spawn hub

Portal volumes go in `travel.yml` `portals`, measured from the promoted hub
build. Build with `toolkit mc build`, rehearse on a `storm-prod` sandbox, then
promote it to live.

## 5. Verify

- `toolkit mc info` lists the world.
- `/rtp <name>` lands inside its border.
- The live map at [bluemap.ts-mc.net](https://bluemap.ts-mc.net) shows it.
- The hub portal and `/worlds` reach it.
- Update the player page
  [docs.ts-mc.net/survival/worlds](https://docs.ts-mc.net/survival/worlds/);
  its border figures must match `world.yml`.

## Related

- [Operate The Storm with the agent harness](/how-to/operate-the-storm-with-the-agent-harness/)
- [Provision The Storm's Search and Destroy worlds](/how-to/provision-the-storm-search-and-destroy-world/)
