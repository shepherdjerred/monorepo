# Refine release-please CHANGELOGs

You are running inside the shepherdjerred/monorepo CI pipeline immediately after `release-please release-pr` opened or updated the release PR on branch `release-please--branches--main`. Your job is to rewrite the per-package CHANGELOG entries that release-please just generated, replacing the auto-generated noise with a tight, library-consumer-focused view, then push a cleanup commit and update the PR body.

A human will review and merge — you do **not** merge.

## Environment

- You are in a Debian-based container with `git`, `gh`, `bun`, `release-please`, and `claude` installed.
- `GH_TOKEN` is set in the environment with write access to the repo (minted from a GitHub App installation token).
- `GIT_ASKPASS` is configured so `git push` to `https://github.com/shepherdjerred/monorepo.git` authenticates automatically.
- The monorepo source is mounted at `/workspace` but **without `.git`** (Dagger excludes it). You must clone a fresh copy to do git operations.
- Set `git config user.name` and `git config user.email` in your fresh clone before committing — use `"release-please-refiner[bot]"` and `"release-please-refiner@users.noreply.github.com"`. Co-author the user on every commit with a `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.

## Procedure

### 1. Find the open release PR

```bash
gh pr list --repo shepherdjerred/monorepo --base main --label "autorelease: pending" --state open --json number,headRefName,body --limit 1
```

If no PR is returned, exit 0 with `<!-- claude-result -->{"status":"no-open-release-pr"}<!-- /claude-result -->`. There is nothing to refine until release-please creates one.

Capture `number` (PR number), `headRefName` (release branch — typically `release-please--branches--main`), and `body` (current PR body).

### 2. Clone the repo at the release branch

Do **not** work in `/workspace` — clone fresh so you have full git history:

```bash
git clone --depth=500 https://github.com/shepherdjerred/monorepo.git /tmp/monorepo
cd /tmp/monorepo
git fetch --tags origin
git checkout <headRefName>
git config user.name  "release-please-refiner[bot]"
git config user.email "release-please-refiner@users.noreply.github.com"
```

### 3. Identify what was bumped

Read `/tmp/monorepo/.release-please-manifest.json` to see the new versions. The three published packages are:

| Package                      | Path                              | Tag prefix                          |
| ---------------------------- | --------------------------------- | ----------------------------------- |
| `astro-opengraph-images`     | `packages/astro-opengraph-images` | `astro-opengraph-images-v<version>` |
| `webring`                    | `packages/webring`                | `webring-v<version>`                |
| `@shepherdjerred/helm-types` | `packages/homelab/src/helm-types` | `helm-types-v<version>`             |

For each package, compare the new version in the manifest against the most recent tag (`git tag -l "<prefix>*" | sort -V | tail -1`). If the manifest version equals the latest tag, that package was not bumped — skip it.

### 4. Inspect the real diff per bumped package

```bash
git diff <last-tag>..origin/main -- <package-path>
git diff --stat <last-tag>..origin/main -- <package-path>
```

Read every non-trivial file change. Walk through the commits with `git log --oneline <last-tag>..origin/main -- <package-path>` to attribute changes accurately.

### 5. Library-consumer filter — DROP these from the CHANGELOG

These ship as monorepo-internal churn or never reach the npm tarball at all:

- devDep bumps in `devDependencies` (eslint, jiti, typescript, vitest, @types/\*)
- `overrides` field in `package.json` (npm consumers ignore overrides on installed packages)
- Tooling pins (mise.toml, bunfig.toml, .bun-version)
- Lockfile churn (`bun.lock`)
- Line-ending or file-permission normalization
- Test-only changes (anything under `**/*.test.ts`, `**/__tests__/`, test fixtures)
- Example app changes (anything under `**/examples/`, `**/example/`)
- `.gitattributes`, `.gitignore`, repo-internal scripts (`scripts/`, `generate_readme.sh`)
- ESLint config edits

### 5b. KEEP these — they are what consumers actually see when they upgrade

- Runtime-dep changes in `dependencies` or `peerDependencies` (verify version diff via `git diff -- package.json`)
- Source/behavior changes under `src/` (verify with `git diff -- src/`)
- README content that ships in the npm tarball (`README.md`)
- `package.json` metadata that ships: `repository`, `bugs`, `homepage`, `version`, `main`, `exports`, `files`, `type`

### 6. Rewrite each new CHANGELOG section

For each bumped package, open `<package-path>/CHANGELOG.md`. The new release-please-generated section starts at `## [<new-version>](https://...) (<date>)` near the top. Replace ONLY that section's contents (between its `## [<new-version>]` header and the next `## [<older-version>]` header). Do not touch older sections.

Format guideline (mirror what was just done by hand on PR #624):

```markdown
## [<new-version>](compare-url) (<date>)

<1-sentence framing — what this release means for users. E.g. "No public API changes." or "Small reliability and packaging improvements.">

- <Concrete consumer-facing change> ([<short-sha>](commit-url))
- <Another concrete change> ([<short-sha>](commit-url))
```

Cite the actual commits that introduced each kept change (resolve via `git log -p`); do not invent commit references. If a package was bumped but has nothing consumer-facing in the diff, write:

> No library behavior changes. The shipped code is identical to `<previous-version>`; this release exists only because of repo-level housekeeping that release-please picked up.

…followed by the (typically tiny) list of things that did change for consumers (e.g. a `repository` URL update in `package.json`).

### 7. Commit and push (only if anything changed)

If `git diff` shows no changes after your edits, do **not** create an empty commit. Emit the result envelope (step 9) with `"packagesRefined": []` and exit 0.

Otherwise:

```bash
git add packages/astro-opengraph-images/CHANGELOG.md \
        packages/webring/CHANGELOG.md \
        packages/homelab/src/helm-types/CHANGELOG.md
# (Only `add` the files you actually edited; do not use `git add -A` or `git add .`.)
git commit -m "chore(root): refine release notes for <YYYY-MM-DD>

Replace release-please's auto-generated entries with a library-consumer
view of what actually shipped in each package.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin <headRefName>
```

**Commit message constraints (enforced by the repo's commit-msg hook):**

- Must use `type(scope): description` conventional form.
- `chore(root): refine release notes for <date>` is the canonical subject for this task.

### 8. Update the PR body to mirror the refined CHANGELOGs

```bash
# Build a body that wraps each refined CHANGELOG section in <details>, same shape as release-please's default.
cat > /tmp/pr-body.md <<'EOF'
:robot: Release notes hand-refined to show only what library consumers actually get when they upgrade.

---

<details><summary>astro-opengraph-images: <new-version></summary>

<refined CHANGELOG section content here>

</details>

<details><summary>webring: <new-version></summary>

<refined CHANGELOG section content here>

</details>

<details><summary>helm-types: <new-version></summary>

<refined CHANGELOG section content here>

</details>

---
Originally generated with [Release Please](https://github.com/googleapis/release-please); release notes refined automatically in CI by `.dagger/prompts/refine-release-please.md`.
EOF

gh pr edit <pr-number> --repo shepherdjerred/monorepo --body-file /tmp/pr-body.md
```

Only include `<details>` blocks for packages that were actually bumped.

### 9. Emit the result envelope and exit 0

```text
<!-- claude-result -->
{"status":"refined","prNumber":<N>,"packagesRefined":["astro-opengraph-images","webring","helm-types"],"commitSha":"<full-sha>"}
<!-- /claude-result -->
```

If you encountered a recoverable issue (e.g., no bumped packages, no PR open), still exit 0 with a descriptive `"status"`. Only exit non-zero on hard failures (auth error, git push rejected, etc.).

## Hard rules

- **Do not merge the PR.** A human reviews.
- **Do not modify older CHANGELOG sections.** Only the just-generated one per package.
- **Do not modify code outside `*/CHANGELOG.md`.** Not even to fix typos in source files.
- **Do not use `git add -A` or `git add .`.** Stage by path.
- **Do not write tokens to files.** `GH_TOKEN` env var only; `GIT_ASKPASS` handles git auth.
- **Do not include `x-access-token` literals in URLs you construct.** Plain `https://github.com/...` works because `GIT_ASKPASS` is set.
- **Do not invent commit SHAs.** Cite real commits from `git log`.

## Reference: what a good refined entry looks like

The manual refinement on PR #624 (2026-05-26 batch) produced these — match this voice and density:

```markdown
## [1.17.0](.../compare/astro-opengraph-images-v1.16.1...astro-opengraph-images-v1.17.0) (2026-05-26)

No library behavior changes. The shipped code is identical to 1.16.1; this release exists only because of repo-level housekeeping that release-please picked up.

- `react` runtime dep pinned to exact `19.2.6` (was `^19.2.5`) ([d040b0b](...))
- README links updated to the monorepo location ([4806f78](...), [aeebe5c](...))
```

```markdown
## [1.7.0](.../compare/webring-v1.6.1...webring-v1.7.0) (2026-05-26)

No public API changes.

- Bump runtime deps `sanitize-html` to `^2.17.4` and `zod` to `^4.4.3` ([078bb6c](...), [d040b0b](...))
- README links updated to the monorepo location ([4806f78](...), [aeebe5c](...))
```

```markdown
## [1.3.0](.../compare/helm-types-v1.2.1...helm-types-v1.3.0) (2026-05-26)

- Spawn errors from the chart fetcher now preserve the original error as `.cause`, so callers can inspect what `helm` or `git` actually failed with ([c285f88](...))
- Published `package.json` now has a cloneable `repository` URL (`git+https://github.com/shepherdjerred/monorepo.git` with `directory: packages/homelab/src/helm-types`), and corrected `bugs`/`homepage` links ([02a3c55](...))
- Bump runtime dep `zod` to `^4.4.3` ([d040b0b](...))
```
