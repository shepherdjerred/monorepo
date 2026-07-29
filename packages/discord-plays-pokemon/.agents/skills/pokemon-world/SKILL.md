---
name: pokemon-world
description: Search Pokémon Emerald maps, regions, connections, warps, terrain, and encounter-capable areas. Use when an objective involves locating a place, choosing a route, understanding where a warp leads, or planning travel.
---

# Pokémon World

Query world knowledge only when the current objective needs geographic facts.

## Workflow

1. Observe the current map before querying.
2. Search with the most specific place, landmark, or connection known:

   ```sh
   pokemonctl knowledge search "Route 101 Littleroot Oldale" --domain world --limit 5
   ```

3. Fetch a promising record when its excerpt is insufficient:

   ```sh
   pokemonctl knowledge get "world:region_route101/main"
   ```

4. Treat the result as game knowledge, not current emulator state. Re-observe before acting.

World records describe topology and static features. Archipelago check and
logic identifiers are labeled as randomizer metadata, not vanilla rewards or
events. The records do not prove that a conditional obstacle is currently
passable and they are not a quest solver.
