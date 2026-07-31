---
id: plan-scout-classic-font-simplification-2026-07-30
type: plan
status: in-progress
board: false
---

# Scout Classic Font Simplification

## Context

PR #1849 (`feat(scout-for-lol): add League Classic reports`) shipped an elaborate
font-loading apparatus for the Classic report look. It exists to render with
**Gill Sans** without ever publishing the binary, because the repo is public and
a desktop/OS font license does not grant redistribution:

- Gill Sans is downloaded at runtime from a private SeaweedFS bucket
  (`scout-classic-fonts`), verified against SHA-256 checksums, and injected into
  the Satori font list. Local renders fall back to `SCOUT_CLASSIC_GILL_SANS_*`
  env-var paths.
- A dedicated Buildkite lane (`scout-classic-visuals`) `aws s3 cp`s the fonts,
  exports the env vars, and renders the fixtures.
- OpenTofu manages the private bucket.
- QTFrizQuad (display font) is already committed, because its Qualitype license
  permits redistribution.

**The owner holds a universal redistribution license for Gill Sans.** That
removes the entire reason for the private-object machinery. We can commit the
fonts like every other font in the package and delete the apparatus.

The Classic code currently lives on the **#1827 branch**
(`chore/scout-data-dragon-16.15.1-6d94e121`) — #1849 was merged into it, not into
`main`. #1827 is still open against `main`. This simplification is therefore a
**new git-spice branch stacked on the #1827 branch**, so it flows to `main`
whenever #1827 merges.

## Decisions (confirmed with owner)

| Question                   | Decision                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Where does the change go?  | New branch stacked on the #1827 branch                                                                                               |
| How to get the font files? | Pull exact `v1` bytes from `s3://scout-classic-fonts` (SHA-256 verified to match the manifest, so snapshots are unaffected)          |
| Bucket + CI lane           | Remove the tofu bucket resource; fold the visual check into the normal scout lane (drop the standalone `scout-classic-visuals` lane) |

Fonts pulled and verified 2026-07-30:

- `GillSans-Regular.ttf` → `6c767e99…cfce5b` ✓ matches manifest
- `GillSans-Bold.ttf` → `34c5ba9c…6217f0` ✓ matches manifest

## Change set

| Piece                                                                | Action                                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `report/src/assets/fonts/GillSans/{Regular,Bold}.ttf` + license file | **Add** the committed fonts                                                                                    |
| `report/src/assets/fonts/classic-fonts.json`                         | **Delete** (SHA manifest)                                                                                      |
| `report/src/assets/classic-fonts.ts`                                 | **Simplify** — load 4 committed files, drop Zod manifest schema, env fallback, `configureClassicGillSansFonts` |
| `backend/src/league/classic-fonts.ts` (+`.test.ts`)                  | **Delete** — SeaweedFS download + checksum + lazy init                                                         |
| `backend/src/startup.ts` (+`.test.ts`)                               | **Remove** `ensureClassicFontsConfigured` dependency/call                                                      |
| `backend/.../match-report-generator.ts`, `prematch-notification.ts`  | **Remove** `ensureClassicFontsConfigured()` calls                                                              |
| `report/src/index.ts`                                                | **Drop** `classicFontManifest`, `configureClassicGillSansFonts` exports                                        |
| `.buildkite/pipeline.yml` (~298–350)                                 | **Remove** the `scout-classic-visuals` lane; ensure fixtures render under the normal scout lane                |
| `.buildkite/scripts/validate-pipeline-scout.ts`                      | **Update/remove** the lane assertions                                                                          |
| `homelab/src/tofu/seaweedfs/buckets.tf`                              | **Remove** the `scout-classic-fonts` bucket resource                                                           |
| `report/scripts/verify-classic-visuals.ts`                           | **Keep**, drop env-var requirement                                                                             |
| `docs/guides/scout-classic-visual-style.md`                          | **Update** — no private objects, no env vars                                                                   |

## Verification

- `bunx turbo run build typecheck test lint --filter='@scout-for-lol/report' --filter='@scout-for-lol/backend' --filter='@scout-for-lol/data'`
- Render Classic fixtures locally (no env vars) and confirm snapshots unchanged
- `bun --no-install .buildkite/scripts/validate-pipeline.ts`
- `tofu -chdir=packages/homelab/src/tofu/seaweedfs fmt -check` and plan

## Follow-ups (operator, out of PR scope)

- Decommission the `scout-classic-fonts` SeaweedFS bucket + objects after the PR
  lands (tofu no longer manages it; the bucket + fonts can be deleted manually).

## Session Log — 2026-07-30

### Done

- Confirmed with owner: universal Gill Sans redistribution license → private-font
  apparatus is unnecessary.
- Pulled the exact `v1` Gill Sans bytes from `s3://scout-classic-fonts` and
  SHA-256-verified them against the old manifest; committed both TTFs + a
  `LICENSE.md` under `report/src/assets/fonts/GillSans/`.
- Collapsed `report/src/assets/classic-fonts.ts` to a committed-file loader;
  deleted the manifest, the backend SeaweedFS/checksum module + test, the
  `ensureClassicFontsConfigured` startup step, the report index exports, the
  standalone `scout-classic-visuals` Buildkite lane + validator, and the tofu
  bucket resource (replaced with a non-destructive `removed {}` block).
- Verified: 15/15 report/backend/data typecheck+test+lint; pipeline validator;
  tofu fmt; and all four Classic fixtures render with committed fonts and no env
  vars (visually confirmed the postmatch render — QTFrizQuad + Gill Sans both OK).
- Commit `afbba0f01` on `feature/scout-classic-font-simplify`; draft PR #1868
  stacked on the #1827 branch (`chore/scout-data-dragon-16.15.1`).

### Remaining

- Human/operator: review + un-draft PR #1868; it merges into the #1827 branch,
  so it reaches `main` when #1827 lands.
- Operator: decommission the `scout-classic-fonts` SeaweedFS bucket + objects
  after this lands (tofu no longer manages it).

### Caveats

- This PR is **stacked on #1827**, not on `main`. #1827 currently carries both
  the Data Dragon 16.15.1 bump and the merged Classic reports (#1849).
- git-spice gotcha hit here: the `worktree add -b … origin/chore/…` set the new
  branch's upstream to the #1827 remote branch, so the first `submit` dry-run
  wanted to push over PR #1827. Fixed by `git branch --unset-upstream` +
  untrack/re-track. Because git-spice's local base ref is stale (the #1827
  branch is checked out in another worktree at an older commit), `--fill` seeded
  a wrong title from an unrelated commit — corrected via `gh pr edit`. The PR
  **diff** is correct (single commit, +158/−395); only metadata was affected.
