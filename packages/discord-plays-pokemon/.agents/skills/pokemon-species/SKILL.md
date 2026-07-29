---
name: pokemon-species
description: Search Generation III Pokémon species, types, evolution lineage, Emerald-specific evolution requirements, and Emerald level-up moves. Use when a goal depends on a Pokémon's identity or capabilities.
---

# Pokémon Species

Search for a species only when its facts affect the plan.

```sh
pokemonctl knowledge search "Ralts type level up moves" --domain species --limit 3
pokemonctl knowledge get "species:ralts"
pokemonctl knowledge search "how to get Shedinja" --domain species --limit 3
```

Species records cover generations I-III and Emerald's version group. They do not report which Pokémon are currently present; use `pokemonctl observe` for live party and battle state.
