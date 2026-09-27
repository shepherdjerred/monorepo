---
title: Build The Storm seasonal doors
description: Place and check the authored Stormnight and Winter Vigil doors in the main world.
---

Build each [configured seasonal door](https://github.com/shepherdjerred/monorepo/blob/6654062adccaa8c16d3d58f76afd174aa0bbc9c5/packages/the-storm/server/owned/plugins/TheStorm/seasonal.yml) at its exact offset from the `world` spawn block before enabling seasonal rewards.

## 1. Record the main-world spawn block

Read the `world` spawn coordinates from the server's world state. Write down the integer block coordinates as `(spawnX, spawnY, spawnZ)`. Use the world spawn, not a player's bed or respawn point.

## 2. Mark the door positions

For every entry under `events[].doors` in [seasonal.yml](https://github.com/shepherdjerred/monorepo/blob/6654062adccaa8c16d3d58f76afd174aa0bbc9c5/packages/the-storm/server/owned/plugins/TheStorm/seasonal.yml), mark the lower half at:

```text
x = spawnX + east
y = spawnY + up
z = spawnZ + south
```

For example, if `world` spawn is `(100, 64, 200)`, Winter Vigil's first door belongs at `(108, 64, 200)`. Its upper half occupies `(108, 65, 200)`.

## 3. Build and inspect each doorway

Place a supporting block below each marked position, then place the configured door material with its lower half on the mark. Leave both halves clear of other blocks. Make each door reachable and openable by a normal player without changing the [configured coordinates](https://github.com/shepherdjerred/monorepo/blob/6654062adccaa8c16d3d58f76afd174aa0bbc9c5/packages/the-storm/server/owned/plugins/TheStorm/seasonal.yml).

Inspect the ring around spawn before building. If terrain, protected builds, or walkways conflict with a mark, revise the authored offsets in the configuration and review that change before placing doors. A nearby replacement door will not qualify.

## 4. Check the layout before activation

In `world`, verify every lower-half coordinate, material, support, reachability, and normal-player access. Check that a nearby unlisted door stays outside the reward path. The [seasonal module is disabled](https://github.com/shepherdjerred/monorepo/blob/6654062adccaa8c16d3d58f76afd174aa0bbc9c5/packages/the-storm/server/owned/plugins/TheStorm/config.yml) until the build and live acceptance are complete.

## Related

- [Seasonal module behavior](https://github.com/shepherdjerred/monorepo/blob/6654062adccaa8c16d3d58f76afd174aa0bbc9c5/packages/the-storm/README.md#seasonal-events)
