---
id: log-2026-07-26-scout-gate-ranked-designs-to-beta
type: log
status: complete
board: false
---

# Gate scout ranked report redesign to beta + local dev

## Context

The two new full-bleed ranked post-match report designs — **Banner** (4760×1500)
and **Square** (4760×4760) — shipped in PR #924 (`83248fe03`, "add two
ranked-game report designs"). They render for ranked **solo/duo and flex**
matches with ≥1 tracked player; one design is picked per match by a stable
FNV-1a hash. Non-ranked queues keep the legacy 4760×3500 report.

**The redesign is already live in prod.** Prod is pinned to image `2.0.0-6347`
(`packages/homelab/src/cdk8s/src/versions.ts`), and #924 is confirmed in that
build's source (`git merge-base --is-ancestor 83248fe03 eba9fcd8a` → true; the
`eba9fcd8a` "bump to 2.0.0-6347" commit recorded the prod digest). The design
selection in `report/src/html/index.tsx` had **no environment gate** — so prod
and beta both rendered the new designs.

User wants it gated to **beta + local dev only** (`environment !== "prod"`).

## Change

The `report` package is intentionally environment-agnostic, so the gate lives in
the backend caller (which knows `configuration.environment`), plumbed through a
render option:

| File                                                                                           | Change                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/scout-for-lol/packages/report/src/html/index.tsx`                                    | Add `enableRankedDesigns?: boolean` to `MatchRenderOptions` (defaults `true` — preserves all existing report snapshot/integration tests). Guard the ranked branch with `options.enableRankedDesigns ?? true`. |
| `packages/scout-for-lol/packages/backend/src/league/tasks/postmatch/match-report-generator.ts` | Import `configuration`; pass `enableRankedDesigns: configuration.environment !== "prod"` into `matchToSvg`.                                                                                                   |

Default-`true` in the library keeps behavior identical for every existing test
(tests run with `ENVIRONMENT` defaulting to `dev`, so `!== "prod"` → enabled).

## Important caveat — prod won't change until promotion

Because prod **already ships** the redesign in image `2.0.0-6347`, this code gate
only takes effect in prod once a gated image is **promoted to prod** (merging the
Renovate PR that bumps `shepherdjerred/scout-for-lol/prod`). Beta gets the gate
on its next continuous build; prod keeps rendering the new designs until promoted.
Once promoted, prod (`environment=prod`) renders the legacy report and beta/dev
keep the new designs.

## Session Log — 2026-07-26

### Done

- Investigated: redesign = PR #924; confirmed live in prod (build 6347 contains it); no env gate existed.
- Implemented the beta+dev gate (2 files above) in worktree `feature/scout-gate-ranked-designs`.

### Remaining

- Finish verify, commit, open draft PR via git-spice.
- Promote to prod (merge the prod-pin Renovate PR) once the gated build is beta — required for prod to actually drop the redesign.

### Caveats

- Prod keeps the redesign until a gated image is promoted (see caveat above).
- `configuration.environment` is `dev | beta | prod`; local dev = `dev` → designs enabled.
