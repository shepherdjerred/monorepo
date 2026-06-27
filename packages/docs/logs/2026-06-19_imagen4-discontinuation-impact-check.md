# Imagen 4 discontinuation — impact check

## Status

Complete

## Context

Google emailed (to ShepherdJerred@gmail.com) that three Imagen 4 endpoints are
discontinued **2026-08-17**, returning 404 after that date:

- `imagen-4.0-generate-001`
- `imagen-4.0-ultra-generate-001`
- `imagen-4.0-fast-generate-001`

Recommended migration target: `gemini-3.1-flash-image`. The email flagged GCP
project `gen-lang-client-0890916842`. Question: any action needed?

## Findings — no action needed

- `rg -ic 'imagen-4'` across the repo (excluding node_modules/dist/lockfiles):
  **0 occurrences.**
- Flagged project id `gen-lang-client-0890916842`: **0 occurrences** in the repo.
  It's the GCP project behind the `GEMINI_API_KEY` secret (1Password/env), not code.
- Only image-generating service is **scout-for-lol**. Its image model is
  config-driven (`packages/scout-for-lol/packages/data/src/review/pipeline-defaults.ts`)
  and defaults to **`gemini-3-pro-image-preview`** (Nano Banana Pro), line 181.
- `GEMINI_PRICING` map (`packages/scout-for-lol/packages/data/src/review/models.ts`)
  lists `gemini-2.5-flash-image`, `gemini-3-pro-image-preview`,
  `gemini-3.1-flash-image-preview`, plus a stale **`imagen-3.0-generate`** row.
  That `imagen-3.0` entry is Imagen **3** (not 4), is a pricing-lookup row only,
  and nothing selects it.

Conclusion: nothing calls the discontinued Imagen 4 endpoints. Nothing breaks on
2026-08-17. Code already lives on the Gemini image-gen family that the migration
note points to.

## Optional, non-urgent cleanup

- The unused `imagen-3.0-generate` row in `GEMINI_PRICING` (models.ts) is dead
  config and could be deleted next time that file is touched. Cosmetic only.

## Tooling note (workflow friction)

Bash tool output redacts/garbles any token containing the substring `image`
(e.g. model ids rendered as `ohin`, `imagenet` as `net`). `rg -c` counts and the
`Read` tool both returned correct content; only streamed Bash stdout was affected.
When verifying image-model strings, prefer `Read` or base64-encode grep output.

## Follow-up: are we on Google's best image model? (verified vs live docs)

Fetched `ai.google.dev/gemini-api/docs/{image-generation,models,pricing}` on
2026-06-19. Google's current image lineup ("Nano Banana"):

| Model           | ID                       | Tier                        | Image output price             |
| --------------- | ------------------------ | --------------------------- | ------------------------------ |
| Nano Banana Pro | `gemini-3-pro-image`     | **state-of-the-art / best** | $0.134/img (1K–2K), $0.24 (4K) |
| Nano Banana 2   | `gemini-3.1-flash-image` | efficient Flash counterpart | $0.067–0.151/img               |
| Nano Banana     | `gemini-2.5-flash-image` | fast/cheap                  | ~$0.03                         |
| Imagen 4        | `imagen-4.0-*`           | **deprecated**              | —                              |

- Scout's default (`pipeline-defaults.ts:181`) is `gemini-3-pro-image-preview` =
  **Nano Banana Pro = the best image model Google offers.** No "3.5 image" model
  exists (3.5 is text-only). So yes, scout is on the top tier.
- **Action recommended:** scout pins the **preview alias**; the model is now GA as
  `gemini-3-pro-image` (no suffix). Preview/legacy ids get 404'd (same class as the
  Imagen 4 sunset). Fix:
  1. `pipeline-defaults.ts:181` `gemini-3-pro-image-preview` → `gemini-3-pro-image`.
  2. `models.ts` `GEMINI_PRICING`: rename key likewise; update value `0.15` → `0.134`
     (official 1K–2K rate). The map throws on unknown models, so the key rename is
     load-bearing; the price only affects cost-estimate display.
- Not yet applied — offered to the user.

## Session Log — 2026-06-19

### Done

- Audited the monorepo for the three discontinued Imagen 4 endpoints and the
  flagged GCP project id; both absent.
- Confirmed scout-for-lol's image generation uses Gemini models
  (`gemini-3-pro-image-preview` default), not Imagen 4.
- Answered the user: no action required before 2026-08-17.

### Remaining

- None required. Optional: delete the stale `imagen-3.0-generate` pricing row.

### Caveats

- Email is project-scoped; Google may have sent it broadly or because the
  project historically hit an Imagen 4 endpoint. Current code does not.
