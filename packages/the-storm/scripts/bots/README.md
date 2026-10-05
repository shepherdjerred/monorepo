# rwfbots personality generator

`generate-personalities.ts` writes the bot personas the server ships under
`server/owned/plugins/TheStorm/rwfbots/personalities/`: one YAML per
personality plus `manifest.json`. Each run (re)generates one batch on top of
the personalities already shipped. Everything but the network answers is a
deterministic function of the batch seed, so a batch can be regenerated bit
for bit. The generator writes no prose: every personality's voice, chat lines,
quirks, rivals and bio come from the committed enrichment files under
`enrichment/`.

```bash
cd packages/the-storm
bun run bots:generate -- --seed 2026-10-b --count 180 --batch seed-2026-10-b \
  --batch-number 2 --skins-from server/owned/plugins/TheStorm/rwfbots/personalities \
  --enrich scripts/bots/enrichment/seed-2026-10.json \
  --enrich scripts/bots/enrichment/seed-2026-10-b-1.json \
  --enrich scripts/bots/enrichment/seed-2026-10-b-2.json \
  --enrich scripts/bots/enrichment/seed-2026-10-b-3.json \
  --enrich scripts/bots/enrichment/seed-2026-10-b-4.json
```

| Flag                      | Meaning                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--seed <text>`           | Seeds every draw of the batch: plan, names, skill, traits, skins. Required.                                                                    |
| `--count <n>`             | How many personalities the batch has. Required.                                                                                                |
| `--batch <name>`          | The batch label recorded in `manifest.json`. Required.                                                                                         |
| `--batch-number <n>`      | The `batch` integer written to each file (`Personality.batch`). An existing batch with this number is replaced; the others are kept. Required. |
| `--enrich <file.json>`    | An enrichment file; repeat for each. Together they must cover every personality in the resulting catalog, and nothing else. Required.          |
| `--prepare <roster.json>` | Plan the batch without text: write the roster authors need, sign the skins, write no personalities. Replaces `--enrich`.                       |
| `--out <dir>`             | The catalog directory. Default: the shipped personalities directory.                                                                           |
| `--skins-dir <dir>`       | Where the generated `<id>.png` sources go. Default `scripts/bots/skins`.                                                                       |
| `--skins-from <dir>`      | A previous output directory; a texture is reused when the id and skin hash match.                                                              |
| `--texture-cache <file>`  | A local JSON cache of signed textures by skin hash, written after every signing, so an interrupted run resumes. Never commit it.               |
| `--offline`               | Skip Mojang and MineSkin. Every texture must be reusable; the batch records `unverifiedNames: true`.                                           |

## Adding a batch

1. Plan it: run with `--prepare <roster.json> --texture-cache <cache.json>`.
   Names are checked against Mojang, skins are drawn and signed, and the
   roster (ids, names, archetypes, skill, traits) is written for authors.
2. Write `enrichment/<batch>[-n].json` for the new ids (see below), and
   update older enrichment when a new rival or story ties into them.
3. Run again with every `--enrich` file and the same cache. The catalog is
   validated whole before anything is written.

## What it does

1. **Carry the catalog.** Personalities of other batches keep their identity
   (`id`, `name`, `skin`, `skill`, `batch`, `retired` from their YAML;
   `archetype` from the manifest). Their knobs are re-derived from their
   archetype profile and batch seed, so a profile change reaches everyone.
2. **Plan the batch.** Each new slot goes to the archetype with the fewest
   personalities in the whole catalog, then to that archetype's emptiest of
   five skill bands, so archetypes stay even and each spans every band.
3. **Derive knobs.** `traits.ts` holds one profile per archetype (style, role
   weights, kit weights, lever z-scores) and jitters it per personality. The
   profiles only set knobs the bots read; the comment at the top of
   `traits.ts` lists what reads each one. Every profile weights at least one
   kit rwf ships (trooper, longbow, shortbow, rewind) so archetypes show in
   play today; ghost, wraith and spy weights wait for those kits.
4. **Choose names.** Syllable and word-list gamer tags with a 2014 feel.
   Candidates must match `[A-Za-z0-9_]{3,16}`, miss a profanity and
   real-person blocklist, be at least two edits from every name in the
   catalog, and be free on Mojang
   (`GET https://api.mojang.com/users/profiles/minecraft/<name>`: 200 is
   taken, 204 or 404 is free). Lookups are paced and retried on 429 and 5xx.
5. **Draw skins.** `skin-png.ts` paints an original 64×64 skin with an
   archetype outfit motif: rushers in red with racing stripes, lurkers in
   dark hoods, snipers in camo, bomb divers in hazard stripes and goggles,
   anchors in steel plates and helmets, flankers in teal sashes, supports in
   white with a green cross, duelists in crimson sashes, hunters in leather,
   turtles in shell checks and helmets, trolls in clashing colours and
   headphones, tacticians in navy with gold epaulettes. `png.ts` encodes the
   PNG. Sources are committed under `skins/` as CC0.
6. **Sign textures.** `mineskin.ts` queues each PNG with MineSkin v2
   (`POST /v2/queue`, then `GET /v2/queue/{jobId}`), honouring
   `rateLimit.next.relative`, and resubmits a job MineSkin failed for an
   upstream rate limit with a growing delay. Anonymous use works (about 6 s
   between submissions); `MINESKIN_API_KEY`, when already set in the
   environment, is sent for the shorter authenticated delay. Nothing is ever
   faked: if MineSkin keeps failing the run stops with the error.
7. **Merge text and validate.** Enrichment is matched to the catalog by id,
   every personality is checked against `PersonalitySchema` in `schema.ts`,
   and the catalog against its rules (unique ids and names, pairwise name
   distance ≥ 2, rivals that exist) before any file is written. Stale files
   of a replaced batch are removed.

## Enrichment files

`enrichment/*.json` are reviewed source, one file per batch or part of a
batch:

```json
{
  "batch": "seed-2026-10-b",
  "personalities": {
    "<id>": {
      "voice": {
        "tone": ["dry"],
        "verbosity": "normal",
        "style": "terse callouts, no punctuation"
      },
      "lines": { "greet": ["..."], "onKill": ["..."], "...": ["..."] },
      "quirks": ["always_gg"],
      "rivals": ["<other id>"],
      "bio": "One to three sentences of backstory."
    }
  }
}
```

Authoring rules (the schema enforces the mechanical ones):

- Players will read every line in game chat. Write fictional regulars of the
  2013–2014 Red Warfare era with distinct voices, humour and history, and keep
  it community-appropriate: no profanity, slurs, sexual content, politics,
  real people or brands, and taunts that tease the play, never the person.
  `schema.ts` rejects a list of banned words as a backstop, not a substitute
  for judgment.
- Lines fit the archetype and the voice note. Each moment (`greet`, `onKill`,
  `onDeath`, `onPlant`, `onDefuse`, `onWin`, `onLoss`, `onLastAlive`,
  `taunt`) has 2–6 distinct lines of at most 80 characters. `lobby` holds
  4–8 lines of pre-match small talk, kit talk and team pep, said while bots
  wait in the lobby; give each character its own, never shared lines.
- Placeholders are filled by the chat layer and only where they make sense:
  `{victim}` in `onKill`, `{killer}` in `onDeath`, `{bomb}` in `onPlant` and
  `onDefuse`, `{team}` (the speaker's team) anywhere. Any other brace fails.
- `voice.tone` is 1–4 tags, `verbosity` is `quiet`, `normal` or `chatty`, and
  `style` is a short note (≤ 120 characters) on how the lines read.
- `quirks` are 1–3 of the `Quirk` vocabulary in `schema.ts` and Java.
- `rivals` are 0–3 other personality ids in the catalog.
- `bio` is 1–3 sentences, at most 300 characters.

## Keeping the schema in sync

`schema.ts` mirrors the Java side: `rwfbots.adapter.content.PersonalityFile`
(the YAML shape) and the `Personality`, `Archetype`, `Voice`, `Lines`,
`Quirk`, `Style`, `LeverOffsets` and `PersonalityCatalog` domain records (the
limits). When an archetype, quirk, placeholder, lever, kit, role, verbosity or
limit changes in Java, change it here in the same commit;
`ShippedPersonalitiesTest` parses the generated files on every plugin build
and is the check that the two agree. The YAML shape is documented in
`server/owned/plugins/TheStorm/rwfbots/README.md`.

## Not in this version

- Slim-model skins and second-layer (hat, jacket) detail.
- Runtime chat: the lines are content only until the chat layer speaks them.
