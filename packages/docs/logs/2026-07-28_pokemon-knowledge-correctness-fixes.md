---
id: pokemon-knowledge-correctness-fixes
type: log
status: complete
board: false
---

# Pokémon knowledge correctness fixes

Correct the generated Emerald knowledge corpus and its pinned-source fetch
behavior after review of commit `d68c44276`.

## Scope

- Classify fixed- and variable-damage attacks correctly in Generation III.
- Stop presenting generation-wide item identifiers as Emerald-obtainable.
- Distinguish Archipelago randomizer metadata from vanilla-safe topology.
- Fetch exact Bulbapedia revisions with bounded, politely paced requests.
- Add regression coverage and regenerate the committed corpus.

## Session Log — 2026-07-28

### Done

- Corrected Generation III damage classification and power labels in
  `scripts/knowledge/pokeapi.ts`.
- Relabeled the item catalog as generation-wide, excluded the five confirmed
  FireRed/LeafGreen-only identifiers, and updated the item skill.
- Relabeled Archipelago check and logic identifiers as non-vanilla randomizer
  metadata and updated the world skill.
- Changed Bulbapedia generation to request exact revision IDs with 30-second
  fetch timeouts and five-second sequential pacing.
- Added generator and committed-corpus regression tests, then regenerated
  `knowledge/generated/records.json` twice with identical content hashes.
- Verified 15 package tests, package typecheck and lint, five skill manifests,
  1,016 Markdown documents, source-link liveness, formatting, and diff hygiene.

### Remaining

- None.

### Caveats

- PokeAPI and the pinned pokeemerald constants are both generation-compatible
  catalogs rather than Emerald obtainability manifests. Records therefore say
  that availability is unverified instead of inferring it from an item ID.
