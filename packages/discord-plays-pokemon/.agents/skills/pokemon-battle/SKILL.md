---
name: pokemon-battle
description: Search Generation III moves, types, power, accuracy, PP, damage class, and priority. Use when move mechanics affect a battle decision.
---

# Pokémon Battle

Query a specific move or mechanic after observing the active battle.

```sh
pokemonctl knowledge search "Tackle power accuracy type" --domain battle --limit 3
pokemonctl knowledge get "battle:move:tackle"
```

The catalog supplies static move facts, not a deterministic battle policy. Prefer the smallest safe action, inspect its outcome, and replan from live HP, status, menu, and opponent state.
