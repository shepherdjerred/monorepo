---
name: pokemon-items
description: Search Generation III item identifiers, categories, and catalog costs. Use when an objective depends on recognizing, buying, or budgeting for an item.
---

# Pokémon Items

Search only when an item fact changes the next decision.

```sh
pokemonctl knowledge search "Poke Ball cost" --domain items --limit 3
pokemonctl knowledge get "items:poke-ball"
```

The PokeAPI catalog is generation-wide, excludes known FireRed/LeafGreen-only
key items, and does not prove that another item is obtainable in Emerald. It
also does not say what the player currently owns or can currently buy; use
`pokemonctl observe` for live inventory and money.
