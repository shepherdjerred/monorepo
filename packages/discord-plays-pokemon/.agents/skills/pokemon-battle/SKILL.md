---
name: pokemon-battle
description: Operate live Pokémon Emerald battles with pokemonctl semantic actions and search Generation III move mechanics. Use when an input-ready battle needs an explicit move, target, item, switch, or run decision.
---

# Pokémon Battle

Start with `pokemonctl observe`. Treat its compact `battle` object as the
authority for the current decision:

- `menu` says which semantic action is available.
- `moves` supplies exact names, slots, PP, and `usable` eligibility.
- `switchAllowed` reports whether a voluntary switch is currently legal.
- `battlers`, party, and inventory identify valid targets and owned resources.

Query static mechanics only when they change the choice:

```sh
pokemonctl knowledge search "Tackle power accuracy type" --domain battle --limit 3
pokemonctl knowledge get "battle:move:tackle"
```

## Execute one explicit choice

At the action menu, use the narrow semantic command that matches the decision:

```sh
pokemonctl battle move "TACKLE"
pokemonctl battle move 2 --target-battler 3
pokemonctl battle item "POTION" --party-slot 1
pokemonctl battle switch 2
pokemonctl battle run
```

Move and item names must exactly match the observed move or inventory name.
Party-targeted medicine requires `--party-slot`; PP medicine is not supported
because this action has no move selector. The engine rejects disabled moves,
trapped switches, inapplicable medicine, and other unavailable choices before
sending controller input.

If observation already reports `menu: "target"`, select the pending target:

```sh
pokemonctl battle target battler 3
pokemonctl battle target party-slot 2
```

Prefer `battle move ... --target-battler` when making a new targeted move.
Inspect the command's settled `after` state and `stopReason` before acting
again. These commands execute the caller's choice; they never choose battle
strategy. The knowledge catalog supplies static facts, not live eligibility or
a deterministic policy.
