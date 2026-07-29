---
name: pokemon-progression
description: Search the complete Pokémon Emerald walkthrough for story order, prerequisites, destinations, gifts, and milestones. Use when the next story step or prerequisite is unclear.
---

# Pokémon Progression

Load only the walkthrough fragments relevant to the current uncertainty.

## Workflow

1. Observe current location, party, inventory, and progress.
2. Search with two or more concrete anchors:

   ```sh
   pokemonctl knowledge search "Birch Route 101 first Pokemon" --domain progression --limit 5
   ```

3. Fetch the best fragment if the excerpt cuts off needed context.
4. Convert the facts into a short plan, then use semantic controls and verify each action.

The walkthrough is reference material from Bulbapedia under CC BY-NC-SA 2.5. Do not paste it into memory wholesale or execute it as a fixed sequence. Current game state remains authoritative.
