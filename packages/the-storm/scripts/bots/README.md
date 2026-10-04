# rwfbots personality generator

`generate-personalities.ts` writes the bot personas the server ships under
`server/owned/plugins/TheStorm/rwfbots/personalities/`: one YAML per
personality plus `manifest.json`. Everything but the network answers is a
deterministic function of `--seed`, so a batch can be regenerated bit for bit.

```bash
cd packages/the-storm
bun run bots:generate -- --seed 2026-10 --count 20 --batch seed-2026-10
```

| Flag                 | Meaning                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--seed <text>`      | Seeds every draw: traits, names, skins. Required.                                                                    |
| `--count <n>`        | How many personalities to write. Required.                                                                           |
| `--batch <name>`     | The batch label recorded in `manifest.json`. Required.                                                               |
| `--batch-number <n>` | The `batch` integer written to each file (`Personality.batch`, from 1). Default `1`.                                 |
| `--out <dir>`        | Output directory. Default: the shipped personalities directory.                                                      |
| `--skins-dir <dir>`  | Where the generated `<id>.png` sources go. Default `scripts/bots/skins`.                                             |
| `--skins-from <dir>` | A previous output directory (YAML + `manifest.json`); textures are reused when the id and skin hash match.           |
| `--offline`          | Skip Mojang and MineSkin. Every texture must come from `--skins-from`; the manifest records `unverifiedNames: true`. |

## What it does

1. **Plan the batch.** Skill bands (five, 0.0–1.0), archetypes (rusher,
   anchor, support, lurker, flex) and primary kits each cycle through their
   options and are shuffled independently, so twenty personalities cover
   every band four times and every kit at least twice.
2. **Sample traits.** Skill inside the band; kit and role weights around the
   archetype; style (aggression, patience, teamplay, risk) jittered around an
   archetype centre; lever offsets as z-scores clipped to ±2 (positive is
   always stronger); tone tags, verbosity and up to five catchphrases; a
   templated bio. `enrichWithLlm()` in `traits.ts` is a documented no-op
   extension point: this version calls no language model.
3. **Choose names.** Syllable and word-list gamer tags with a 2014 feel
   (`ShadowFalcon07`, `xXWolfKnightXx`, `KravithHD`). Candidates must match
   `[A-Za-z0-9_]{3,16}`, miss a profanity and real-person blocklist, be at
   least two edits from every accepted name, and be free on Mojang
   (`GET https://api.mojang.com/users/profiles/minecraft/<name>`: 200 is
   taken, 204 or 404 is free). Lookups are paced and retried with backoff on
   429 and 5xx.
4. **Draw skins.** `skin-png.ts` paints an original 64×64 Steve-model skin
   (skin tone, hair, eyes, shirt pattern, sleeves, pants, shoes) from the
   seed and encodes the PNG itself. The sources are committed under `skins/`
   as CC0 so the signed textures can always be traced to their pixels.
5. **Sign textures.** `mineskin.ts` queues each PNG with MineSkin v2
   (`POST /v2/queue`, then `GET /v2/queue/{jobId}`), honouring the
   `rateLimit.next.relative` delay in every response. Anonymous use works with
   the documented longer delay; set `MINESKIN_API_KEY` for the authenticated
   one. The response's `skin.texture.data.{value,signature}` become
   `skin.value` and `skin.signature`. Nothing is ever faked: if MineSkin fails
   after retries the run stops with the error.
6. **Validate and write.** Each personality is checked against
   `PersonalitySchema` in `schema.ts` and the batch against the catalog rules
   (unique ids and names, pairwise name distance ≥ 2) before any YAML is
   written.

## Keeping the schema in sync

`schema.ts` mirrors the Java side: `rwfbots.adapter.content.PersonalityFile`
(the YAML shape) and the `Personality`, `Chat`, `Style`, `LeverOffsets` and
`PersonalityCatalog` domain records (the limits). When a lever, kit, role,
verbosity or limit changes in Java, change it here in the same commit;
`ShippedPersonalitiesTest` parses the generated files on every plugin build
and is the check that the two agree. The YAML shape is documented in
`server/owned/plugins/TheStorm/rwfbots/README.md`.

## Not in this version

- Appending a second batch to an existing catalog (the generator owns its
  output directory and writes the whole batch).
- Language-model bios and catchphrases (`enrichWithLlm`).
- Slim-model skins and second-layer (hat, jacket) detail.
