# Polyrepo → Monorepo Link Audit

## Status

In Progress — rewrite and lychee CI gate not yet implemented.

## Context

Many packages in this monorepo (`github.com/shepherdjerred/monorepo`) used to live as standalone polyrepos under `github.com/shepherdjerred/<package>`. After consolidating into the monorepo, hundreds of stale polyrepo links remain in package metadata, READMEs, blog posts, in-app UI, ESLint rule URLs, install scripts, Discord bot help text, source comments, and config files.

The intent of this plan is to find every reference to an old polyrepo URL or slug and rewrite it to the canonical monorepo path (`github.com/shepherdjerred/monorepo/tree/main/packages/<name>` for tree links, `github.com/shepherdjerred/monorepo/issues` for issue links, `github.com/shepherdjerred/monorepo.git` for clone URLs, etc.). Out of scope: the `archive/` directory (frozen per repo CLAUDE.md), `node_modules/`, lockfiles, `.claude/worktrees/` (transient), and ipynb forks of upstream content.

## URL Rewrite Conventions

These are **candidate** rewrites — every produced URL must pass liveness check (see "Mandatory: Link Liveness Gate" below) before being written to a file.

| Old form                                                                       | New form (candidate)                                                                                      |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `https://github.com/shepherdjerred/<pkg>`                                      | `https://github.com/shepherdjerred/monorepo/tree/main/packages/<pkg>`                                     |
| `https://github.com/shepherdjerred/<pkg>.git`                                  | `https://github.com/shepherdjerred/monorepo.git`                                                          |
| `git+https://github.com/shepherdjerred/<pkg>.git`                              | `git+https://github.com/shepherdjerred/monorepo.git`                                                      |
| `https://github.com/shepherdjerred/<pkg>/issues`                               | `https://github.com/shepherdjerred/monorepo/issues`                                                       |
| `https://github.com/shepherdjerred/<pkg>/issues/<n>`                           | `https://github.com/shepherdjerred/monorepo/issues/<n>` if `n` exists in monorepo, else `monorepo/issues` |
| `https://github.com/shepherdjerred/<pkg>/blob/main/<path>`                     | `https://github.com/shepherdjerred/monorepo/blob/main/packages/<pkg>/<path>`                              |
| `https://github.com/shepherdjerred/<pkg>/commit/<sha>`                         | rewrite host; verify SHA resolves in monorepo                                                             |
| `https://github.com/shepherdjerred/<pkg>/releases/...`                         | `https://github.com/shepherdjerred/monorepo/releases/...` (release-please uses tag prefixes per package)  |
| `https://github.com/shepherdjerred/share/tree/main/packages/eslint-config/...` | `https://github.com/shepherdjerred/monorepo/tree/main/packages/eslint-config/...`                         |
| `https://raw.githubusercontent.com/shepherdjerred/<pkg>/main/<file>`           | `https://raw.githubusercontent.com/shepherdjerred/monorepo/main/packages/<pkg>/<file>`                    |

Sub-package-aware mappings:

- `scout-for-lol/packages/{backend,frontend,desktop,report,data}` → `monorepo/packages/scout-for-lol/packages/{backend,frontend,desktop,report,data}`
- `homelab` (root README ref to `src/cdk8s/...`) → `monorepo/packages/homelab/src/cdk8s/...`

## Mandatory: Link Liveness Gate

**Every URL produced by this rewrite — every single one — must be liveness-checked before it lands in a file.** No assumed-good links.

Workflow per URL:

1. Apply candidate rewrite from the table above.
2. `curl -sIL -o /dev/null -w '%{http_code} %{url_effective}\n' <candidate>` (follow redirects, accept 200/301/302→200).
3. If 200: write the URL.
4. If 404 / non-200:
   - For `blob/<sha>/<path>` and `commit/<sha>`: try `blob/main/packages/<pkg>/<path>` next; if that 200s, use it (SHA pin is lost). If still 404, **drop the link** and keep the surrounding prose intact rather than ship a dead URL.
   - For `tree/main/packages/<pkg>`: 200 should always succeed for known packages; if not, the package path is wrong — investigate before writing.
   - For `issues/<n>` and `releases/...`: if the specific number/tag doesn't exist, fall back to `issues` / `releases` root.
5. Log every fallback decision so the commit message can disclose what was demoted.

**Bulk verification:** after applying all candidate rewrites, extract every produced URL with `rg -oP 'https?://[^\s)>"]+' <changed-files>` and pipe through a parallel `curl -sIL` script. Treat any non-2xx as a failure and reopen those edits before committing.

## Files to Change

### 1. Package metadata (npm / cargo / maven / cabal)

| File                                                           | What to change                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/scout-for-lol/packages/backend/package.json`         | `repository.url`, `homepage`, `bugs.url` (lines 83, 85, 87)                             |
| `packages/scout-for-lol/packages/frontend/package.json`        | `repository.url`, `homepage`, `bugs.url` (lines 69, 71, 73)                             |
| `packages/scout-for-lol/packages/desktop/package.json`         | `repository.url`, `homepage`, `bugs.url` (lines 73, 75, 77)                             |
| `packages/scout-for-lol/packages/report/package.json`          | `repository.url`, `homepage`, `bugs.url` (lines 50, 52, 54)                             |
| `packages/homelab/src/helm-types/package.json`                 | `repository.url`, `bugs.url`, `homepage` (lines 46, 50, 52)                             |
| `packages/scout-for-lol/packages/desktop/src-tauri/Cargo.toml` | `repository = "..."` (line 7)                                                           |
| `packages/castle-casters/pom.xml`                              | `<url>` x2, `<scm><connection>`, `<developerConnection>` (lines 14, 34–36)              |
| `practice/jlox/pom.xml`                                        | `<url>` x2, `<scm><connection>`, `<developerConnection>` (lines 14, 17–19)              |
| `practice/learn-you-a-haskell-exercises/exercises.cabal`       | `description`, `homepage`, `bug-reports`, `source-repository.location` (lines 9–11, 23) |

### 2. ESLint rule documentation URLs (referencing old `share` polyrepo)

All in `packages/eslint-config/src/rules/`. Pattern: `https://github.com/shepherdjerred/share/tree/main/packages/eslint-config/src/rules/${name}.ts` → `https://github.com/shepherdjerred/monorepo/tree/main/packages/eslint-config/src/rules/${name}.ts`

Files: `no-use-effect.ts`, `prisma-client-disconnect.ts`, `no-type-assertions.ts`, `prefer-date-fns.ts`, `no-shadcn-theme-tokens.ts`, `no-function-overloads.ts`, `no-dto-naming.ts`, `jscpd-duplication.ts`, `no-type-guards.ts`, `prefer-zod-validation.ts`, `satori-best-practices.ts`, `no-redundant-zod-parse.ts`, `knip-unused.ts`, `zod-schema-naming.ts`, `no-re-exports.ts`, `prefer-bun-apis.ts`, `prefer-structured-logging.ts` (17 files).

Reference (already correct): `prefer-async-await.ts`. Do not hand-edit compiled `dist/` files.

### 3. Documentation (README / Markdown / mkdocs)

| File                                                                       | Refs | Notes                                                                     |
| -------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------- |
| `packages/sjer.red/src/pages/projects.md`                                  | 21   | Project listing — each header link → monorepo `tree/main/packages/<name>` |
| `packages/scout-for-lol/README.md`                                         | ~3   | Lines 156–157                                                             |
| `packages/scout-for-lol/packages/desktop/AUTO_UPDATER.md`                  | 1    | Line 142 — release artifact URL; verify tag pattern first                 |
| `packages/astro-opengraph-images/README.md.tmpl`                           | 8    | Source template — fix here, README.md regenerates                         |
| `packages/astro-opengraph-images/README.md`                                | 8    | Fix or regenerate from `.tmpl`                                            |
| `packages/webring/README.md`                                               | 3    | Lines ~12, 30, 59, 89                                                     |
| `packages/macos-cross-compiler/README.md`                                  | 1    | Line 24                                                                   |
| `packages/homelab/README.md`                                               | 1    | Line 36                                                                   |
| `packages/clauderon/examples/README.md`                                    | 1    | Line 117                                                                  |
| `packages/clauderon/docs/IMAGE_COMPATIBILITY.md`                           | 1    | Line 334                                                                  |
| `packages/clauderon/docs/src/content/docs/getting-started/installation.md` | 5    | Various                                                                   |
| `packages/discord-plays-pokemon/docs/mkdocs.yml`                           | 1    | Line 3: `repo_url:`                                                       |
| `packages/discord-plays-pokemon/docs/docs/user/index.md`                   | 1    | Line 9                                                                    |

### 4. In-app UI / component links

| File                                                                       | Refs                  |
| -------------------------------------------------------------------------- | --------------------- |
| `packages/scout-for-lol/packages/frontend/src/components/Footer.astro`     | 2 (lines 30, 59)      |
| `packages/scout-for-lol/packages/frontend/src/components/Navbar.astro`     | 2 (lines 17, 26)      |
| `packages/scout-for-lol/packages/frontend/src/pages/support.astro`         | 3 (lines 31, 85, 123) |
| `packages/scout-for-lol/packages/frontend/src/pages/getting-started.astro` | 1 (line 209)          |
| `packages/better-skill-capped/src/components/footer.tsx`                   | 2 (lines 12, 22)      |

### 5. Discord bot user-facing strings & error messages

| File                                                                    | Line | Notes                               |
| ----------------------------------------------------------------------- | ---- | ----------------------------------- |
| `packages/scout-for-lol/packages/backend/src/discord/commands/help.ts`  | 93   | GitHub Issues string in help output |
| `packages/scout-for-lol/packages/backend/src/discord/commands/index.ts` | 327  | Same pattern                        |
| `packages/discord-plays-pokemon/packages/backend/src/util.ts`           | 11   | Error message issue link            |

### 6. Source-code TODO comments

All scout-for-lol; issue numbers → `monorepo/issues`:

- `packages/scout-for-lol/packages/data/src/model/arena/arena.ts:39`
- `packages/scout-for-lol/packages/report/src/html/champion/gold.tsx:3`
- `packages/scout-for-lol/packages/report/src/html/champion/kda.tsx:4`
- `packages/scout-for-lol/packages/report/src/html/champion/damage.tsx:4`
- `packages/scout-for-lol/packages/report/src/html/champion/names.tsx:3`
- `packages/scout-for-lol/packages/report/src/html/champion/runes.tsx:11`
- `packages/scout-for-lol/packages/backend/src/testing/discord-mocks.ts:14–15`
- `packages/scout-for-lol/packages/backend/prisma/schema.prisma:47`

### 7. Scripts and runtime URLs

| File                                               | Line | Change                                                                       |
| -------------------------------------------------- | ---- | ---------------------------------------------------------------------------- |
| `packages/dotfiles/install.sh`                     | 196  | `chezmoi init --apply https://github.com/shepherdjerred/dotfiles` → monorepo |
| `packages/dotfiles/install_macos.sh`               | 75   | Same                                                                         |
| `packages/temporal/src/activities/deps-summary.ts` | 6    | `REPO_URL` for homelab → monorepo                                            |
| `scripts/scrape-apple-hig.py`                      | 296  | User-Agent string referencing old `glern` repo                               |

### 7b. Go module migration: terraform-provider-asuswrt

| File                                                    | Change                                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/terraform-provider-asuswrt/go.mod`            | `module github.com/shepherdjerred/terraform-provider-asuswrt` → `module github.com/shepherdjerred/monorepo/packages/terraform-provider-asuswrt` |
| `packages/terraform-provider-asuswrt/main.go`           | Import path (line 10); confirm registry address (line 22) with user before changing                                                             |
| `packages/terraform-provider-asuswrt/internal/**/*.go`  | All internal imports (15+ files)                                                                                                                |
| `packages/terraform-provider-asuswrt/.golangci.yml:185` | Linter exclusion path                                                                                                                           |
| `packages/terraform-provider-asuswrt/GNUmakefile`       | If it references the old path                                                                                                                   |

After: run `go mod tidy`, `go build ./...`, `go test ./...`.

### 8. Blog posts (sjer.red)

- `packages/sjer.red/src/content/blog/2024/pokemon.mdx` (12 refs — heaviest, commit-pinned)
- `packages/sjer.red/src/content/blog/2025/writing-typescript-with-ai.mdx` (9)
- `packages/sjer.red/src/content/blog/2024/job-hunt.mdx` (2)
- `packages/sjer.red/src/content/blog/2024/homelab-1.mdx` (1)
- `packages/sjer.red/src/content/blog/2023/xstate.mdx` (1)
- `packages/sjer.red/src/content/blog/drafts/homelab-2.mdx` (1)
- `packages/sjer.red/src/content/blog/drafts/homelab-3.mdx` (2)

Commit-pinned URLs: try monorepo+SHA first (curl verify), fall back to `blob/main/packages/<pkg>/<path>`, drop link as last resort. Document fallbacks in commit message.

### 9. Already correct — do NOT change

- All `.dagger/src/image.ts` OCI source labels, `.dagger/src/release.ts` clone URL
- `.buildkite/pipeline.yml`, `scripts/ci/`, `tools/oci/Dockerfile*`
- `packages/temporal/src/activities/data-dragon.ts`
- `packages/glance/GlanceApp/Sources/Views/AppCommands.swift`
- All `ghcr.io/shepherdjerred/<image>` refs (container image names, not source URLs)
- All `@shepherdjerred/<workspace-name>` imports (npm package names)

### 10. Auto-generated CHANGELOGs — bulk rewrite

| File                                           | Refs                   |
| ---------------------------------------------- | ---------------------- |
| `packages/webring/CHANGELOG.md`                | 134                    |
| `packages/astro-opengraph-images/CHANGELOG.md` | 133                    |
| `packages/homelab/src/helm-types/CHANGELOG.md` | 8                      |
| `packages/clauderon/CHANGELOG.md`              | ~10 historical entries |

Scripted `sed` rewrite: swap host to monorepo; for `compare/` URLs use `<pkg>-v<x>...<pkg>-v<y>` tag prefix style.

### 11. Buildkite CI: persistent link-check gate (new)

**Tool:** [lychee](https://github.com/lycheeverse/lychee) — single Rust binary, fast, scans Markdown/HTML/source/JSON/TOML/YAML, supports GitHub auth for rate limits.

**Files to add:**

`lychee.toml` (repo root):

```toml
max_redirects = 5
max_concurrency = 16
timeout = 30
retry_wait_time = 10
accept = [200, 206, 429]
include_verbatim = true
no_progress = true
cache = true
max_cache_age = "7d"

exclude_path = [
  "archive/",
  "node_modules/",
  ".claude/worktrees/",
  "practice/fastbook/",
  "packages/webring/src/testdata/",
  "**/CHANGELOG.md",
  "**/dist/",
  "**/bun.lock",
  "**/Cargo.lock",
  "**/package-lock.json",
  "**/generated/",
]

exclude = [
  "^https?://(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|.*\\.local|.*\\.internal|.*\\.svc|.*\\.cluster\\.local)",
  "^https?://.*\\.tailscale\\.net",
  "^ghcr\\.io/",
  "^docker\\.io/",
  "^registry\\.opentofu\\.org/",
  "^@shepherdjerred/",
]
```

`.buildkite/scripts/lychee.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "+++ :link: Checking links with lychee"
exec lychee --config lychee.toml --github-token "$GITHUB_TOKEN" .
```

`scripts/ci/src/steps/quality.ts` — add alongside `markdownlintStep`:

```typescript
export function lycheeStep(): BuildkiteStep {
  return plainStep({
    label: ":link: Lychee link check",
    key: "lychee",
    command: annotatedScanCmd("bash .buildkite/scripts/lychee.sh", "lychee"),
    timeoutMinutes: 15,
    softFail: true, // flip to hard-fail after first clean run
    artifactPaths: ["/tmp/lychee.txt"],
  });
}
```

Wire into `pipeline-builder.ts` alongside other quality gates. Add `.lycheecache` to `.gitignore`. Add root script `"linkcheck": "lychee --config lychee.toml ."`. Pin lychee in `mise.toml` for Renovate tracking.

## User-confirmed decisions

1. **Cooklang for Obsidian: leave as-is (hard requirement).** `.dagger/src/release.ts:567,573`, `packages/cooklang-for-obsidian/README.md`, and `packages/cooklang-rich-preview/` all reference `shepherdjerred/cooklang-for-obsidian` — do not change.
2. **terraform-provider-asuswrt: migrate to monorepo subpath** — see section 7b.
3. **Auto-generated CHANGELOGs: rewrite all** — see section 10.
4. **Blog-post commit-pinned URLs: check liveness, do best** — see section 8.

## Still ambiguous (surface in PR)

- **Tauri identifier `com.shepherdjerred.scout-for-lol`** — bundle ID, not URL; changing breaks auto-update. Leaving as-is.
- **Scout-for-LoL auto-updater feed** (`AUTO_UPDATER.md:142`) — verify release-please tag/asset convention before swapping.
- **`ghcr.io/shepherdjerred/dotfiles` devcontainer image** — image name, not source URL. Leaving as-is.

## Out of Scope

- `archive/**`, `node_modules/`, lockfiles, `.claude/worktrees/`
- `practice/fastbook/*.ipynb` (forked upstream content)
- `gist.github.com/shepherdjerred/...` URLs (gists are independent)
- `packages/webring/src/testdata/rss-1.xml` (test fixture)
- `@shepherdjerred/<name>` workspace imports
- `ghcr.io/shepherdjerred/<image>` container image names
- All cooklang-for-obsidian references (hard requirement)
- Tauri bundle identifier

## Verification

```bash
# 1. Liveness gate — must be zero failures before commit
git diff --name-only main...HEAD > /tmp/changed.txt
xargs -a /tmp/changed.txt rg -oP 'https?://[^\s)>"\]\\}]+' | sort -u > /tmp/all-urls.txt
parallel -j 16 -a /tmp/all-urls.txt \
  'echo -n "$(curl -sIL -o /dev/null -w %{http_code} {}) "; echo {}' > /tmp/liveness.txt
awk '$1 !~ /^2/' /tmp/liveness.txt   # must print zero lines

# 2. Static audit — zero unexpected polyrepo hits
rg 'github\.com/shepherdjerred/(?!monorepo)' \
  -g '!archive/**' -g '!node_modules/**' \
  -g '!**/bun.lock' -g '!**/Cargo.lock' \
  -g '!**/*.ipynb' -g '!**/dist/**' -g '!.claude/worktrees/**'

# 3. Build checks
bun run typecheck
bun run --filter='./packages/eslint-config' build
bunx eslint . --fix  # in modified packages

# 4. Go checks (after section 7b)
cd packages/terraform-provider-asuswrt && go mod tidy && go build ./... && go test ./...
```
