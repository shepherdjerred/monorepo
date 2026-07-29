---
name: pokemon-items
description: Search Pokémon Emerald item identifiers, categories, and shop costs. Use when an objective depends on obtaining, recognizing, buying, or budgeting for an item.
---

# Pokémon Items

Search only when an item fact changes the next decision.

```sh
pokemonctl knowledge search "Poke Ball cost" --domain items --limit 3
pokemonctl knowledge get "items:poke-ball"
```

The catalog describes game data. It does not say what the player currently owns or can currently buy; use `pokemonctl observe` for live inventory and money.
