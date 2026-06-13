# Top-level repo cleanup

## Status

Complete (committed to `feature/top-level-cleanup`; not yet pushed/PR'd)

## Goal

Tidy the monorepo's top level. Remove dead directories and consolidate the
three non-product scratch trees into one.

## What changed

Branch: `feature/top-level-cleanup`, commit `6c7bff856`.

### Removals

- **`obsidian/`** — standalone Obsidian vault snapshot (15 files). Grepped the
  whole repo: nothing in build/CI/ignore referenced it. Deleted.
- **`tools/`** — entirely dead:
  - `tools/oci/Dockerfile.obsidian-headless` (pinned 0.0.7) and
    `tools/oci/obsidian-headless/Dockerfile` (0.0.8) were both unused — the
    obsidian-headless image is built **in code** (`.dagger/src/image.ts`
    `buildObsidianHeadlessImageHelper`) from `versions.ts`, not from any
    Dockerfile.
  - `tools/oci/git_sha_tag.tmpl` had zero references.
  - Dropped the now-orphaned `"tools/oci/**/Dockerfile"` glob from
    `renovate.json`.

### Consolidation

Moved `archive/`, `poc/`, `practice/` → `sandbox/{archive,poc,practice}`
(umbrella dir chosen by the user to keep the frozen-vs-active distinction; the
"do not modify" rule is now scoped to `sandbox/archive/`).

Updated every **root-anchored** path reference:

| File                                   | Change                                                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knip.json`                            | `archive/**`,`practice/**`,`poc/**` → `sandbox/...`                                                                                                                  |
| `renovate.json`                        | `matchFileNames` + `ignorePaths` → `sandbox/...`                                                                                                                     |
| `.markdownlint-cli2.jsonc`             | `archive/**`,`practice/**` → `sandbox/...`                                                                                                                           |
| `.largeignore`                         | castle-casters path → `sandbox/archive/...`                                                                                                                          |
| `.prettierignore`                      | `archive/`, `practice/bevy-experiment/assets/` → `sandbox/...`                                                                                                       |
| `.gitattributes`                       | clauderon paths + `archive/** -text`,`practice/** -text` → `sandbox/...`                                                                                             |
| `lefthook.yml`                         | 4× `archive/**` excludes, `${f#archive/}` strip → `sandbox/archive/...`; **added** `sandbox/archive/**` to shellcheck exclude and `**/CLAUDE.md` to prettier exclude |
| `scripts/check-todos.ts`               | `!archive/**` → `!sandbox/archive/**`                                                                                                                                |
| `scripts/check-env-var-names.sh`       | `:!:archive/ :!:practice/` → `:!:sandbox/...`                                                                                                                        |
| `scripts/check-react-version-sync.ts`  | `archive/**` → `sandbox/archive/**`                                                                                                                                  |
| `scripts/validate-commit-msg.ts`       | scope-doc comments → `sandbox/...`                                                                                                                                   |
| `.dagger/src/quality.ts`               | trivy `--skip-dirs archive/practice` → `sandbox/...`                                                                                                                 |
| `.buildkite/scripts/update-readmes.sh` | cog/git paths → `sandbox/...`                                                                                                                                        |
| `README.md`                            | "Other Directories" table + cog cmd → `sandbox/...` (added poc row)                                                                                                  |
| `sandbox/{archive,practice}/README.md` | cog `GITHUB_URL` → `tree/main/sandbox/...`                                                                                                                           |
| `AGENTS.md`                            | Structure section → `sandbox/` tree                                                                                                                                  |

**Left as-is (verified still correct after the move):**

- `.gitleaks.toml` `archive/` — unanchored regex, still matches `sandbox/archive/`.
- `.dagger/src/constants.ts` `**/archive`,`**/practice` (SOURCE_EXCLUDES) — glob
  still matches; constants test asserts `**/archive`, so unchanged.
- `.dagger/src/quality.ts` shellcheck/large-file `find -not -path "*/archive/*"`
  — matches `sandbox/archive/`.
- `scripts/{setup,update-lockfiles,generate-deps,quality-ratchet}.ts` — basename
  skips or `packages/`-scoped scans; unaffected.
- `scripts/check-line-endings.ts` — keys off the `-text` gitattribute (covered).

## Verification

- Guard scripts pass: `check-todos`, `generate-deps --check`,
  `check-react-version-sync` (38 lockfiles), `check-env-var-names`.
- JSON valid (`knip.json`, `renovate.json`); `prettier --check` + `markdownlint`
  clean on edited files; `.dagger` constants test 16/16.
- Full pre-commit hook suite (gitleaks, line-endings, large-files, shellcheck,
  prettier, markdownlint, quality-ratchet, dagger-hygiene, etc.) passed on the
  commit.

## Session Log — 2026-06-13

### Done

- Removed `obsidian/` and `tools/`; dropped orphaned renovate glob.
- Consolidated `archive`/`poc`/`practice` under `sandbox/` and rewired ~18
  config/script/doc files. Committed as `6c7bff856` on
  `feature/top-level-cleanup`.
- Pointed **living agent docs** at the new `sandbox/` paths (`b59f09f30`):
  `architecture/2026-02-22_monorepo-structure.md`, the `oai-solution-reviewer`
  skill, and `tasks-for-obsidian/AGENTS.md`. Also updated out-of-repo agent
  context: the live `oai-solution-reviewer` skill copies (`~/.agents` +
  `~/.claude`, hardlinked) and the `user_oai_interview_prep` memory + index.
  Left historical `logs/`/`plans/` unchanged (point-in-time record).

### Remaining

- **Push + open PR** (held pending user confirmation — outward-facing).
- After merge: `git worktree remove .claude/worktrees/top-level-cleanup` and
  `git branch -d feature/top-level-cleanup`.

### Caveats

- Two hook fixes were needed because the move re-stages files that were never
  staged under the lint hooks before: (1) frozen `sandbox/archive/**` `.sh`
  files have intentional CRLF and tripped `shellcheck` (excluded, mirroring CI's
  `*/archive/*` skip); (2) `CLAUDE.md`→`AGENTS.md` symlinks in `poc` tripped the
  prettier hook because prettier errors on _explicitly-passed_ symlinks
  (excluded `**/CLAUDE.md` from the prettier hook; CI's `prettier --check .`
  glob already skips symlinks).
- The cog-generated link bodies in the two sub-READMEs were rewritten via the
  `GITHUB_URL` prefix swap; they'll be regenerated on the next `update-readmes`
  CI run anyway.
- This is a 6.7k-file rename commit. CI will likely treat it as a broad change
  and rebuild widely.
