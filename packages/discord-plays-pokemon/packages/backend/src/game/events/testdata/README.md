# Game-state save fixtures

Real 128 KiB Pokémon Emerald battery saves (`.sav`) used by `saves.test.ts` to
regression-test the memory parser (`parsePartyMon`, `readGameSnapshot`) against
real, encrypted game data — not just synthetic buffers.

Save files are battery/SRAM dumps of player progress (species ids, levels,
flags, names) — data values, no game code or copyrighted assets — so they're
safe to vendor as test fixtures. Each is exactly 131072 bytes.

| File                | State                                                | Source                                                                                                                                             |
| ------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `after_starter.sav` | Early game: Torchic Lv8 + Feebas, 0 badges           | [huderlem/gomons](https://github.com/huderlem/gomons) `gen3/assets_test/e_pkhex_after_starter.sav`                                                 |
| `champion.sav`      | Post-champion: 6 × Lv60 team, 8 badges, full Pokédex | [huderlem/gomons](https://github.com/huderlem/gomons) `gen3/assets_test/e_pkhex_champ.sav`                                                         |
| `midgame.sav`       | Mid game: 5-mon party (nicknamed), 3 badges          | [Bl1ndBeholder/pokemon-saves](https://github.com/Bl1ndBeholder/pokemon-saves) `emerald/011020251345.sav` (16 trailing RTC bytes trimmed to 131072) |

The expected values pinned in `saves.test.ts` were captured from these saves
and sanity-checked for coherence (real species, sensible levels, badge counts
consistent with the labelled game state).
