---
name: pokemon-world
description: Inspect and traverse live Pokémon Emerald maps with pokemonctl, and search static regions, connections, warps, terrain, and encounter areas. Use when an objective involves locating a place, choosing or crossing one map exit, or planning travel.
---

# Pokémon World

## Workflow

1. Run `pokemonctl observe` and treat its map and coordinates as current truth.
2. List the engine-authored exits for that map:

   ```sh
   pokemonctl map exits
   ```

3. Choose exactly one returned stable `id`. Check `traversableByNavigate`; do
   not invent a destination when it is `null` or dynamic.
4. Traverse only that selected exit:

   ```sh
   pokemonctl navigate --exit "connection:0" --max-steps 64
   pokemonctl navigate --exit "warp:2" --max-steps 64
   ```

5. Inspect the settled `after` state and `stopReason`, then list exits again
   after any map change. Exit IDs are scoped to the current map.

For bounded movement to a coordinate on the same map, use:

```sh
pokemonctl map show --radius 8
pokemonctl navigate --x 14 --y 9 --max-steps 64
```

Query world knowledge only when the route choice needs static geography. Search
with the most specific place, landmark, or connection known:

```sh
pokemonctl knowledge search "Route 101 Littleroot Oldale" --domain world --limit 5
```

Fetch a promising record when its excerpt is insufficient:

```sh
pokemonctl knowledge get "world:region_route101/main"
```

Treat the result as game knowledge, not current emulator state. Re-observe
before acting.

World records describe topology and static features. Archipelago check and
logic identifiers are labeled as randomizer metadata, not vanilla rewards or
events. The records do not prove that a conditional obstacle is currently
passable and they are not a quest solver. `navigate --exit` executes one
caller-selected transition; it never chooses or chains a route.
