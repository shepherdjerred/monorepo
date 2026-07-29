---
name: pokemon-items
description: Search Generation III item identifiers and categories. Use when an objective depends on recognizing an item.
---

# Pokémon Items

Search only when an item fact changes the next decision.

```sh
pokemonctl knowledge search "Poke Ball category" --domain items --limit 3
pokemonctl knowledge get "items:poke-ball"
```

The PokeAPI catalog is generation-wide, excludes known FireRed/LeafGreen-only
key items, and does not prove that another item is obtainable in Emerald. It
does not include prices because PokeAPI's catalog cost is not version-specific.
It also does not say what the player currently owns or can currently buy; use
`pokemonctl observe` for live inventory and money, and progression knowledge
for Emerald-specific shop guidance.
