# Local CI/Release CLI (`ci-local`)

Run deploy and release workflows locally without Buildkite.

## Quick Start

```bash
cd scripts/ci
uv run ci-local --help              # see all commands
uv run ci-local list-targets        # see available targets
uv run ci-local --dry-run homelab-deploy --target scout   # preview a deploy
```

## Global Flags

| Flag | Description |
|------|-------------|
| `--version VERSION` | Override auto-generated version (default: `1.1.<patch>-local.<timestamp>`) |
| `--dry-run` | Show what would happen without executing. Env var checks are skipped. |
| `--verbose` | Print version, git SHA, branch, and run directory at startup |

## Commands

### `homelab-deploy`

Full orchestration: push images, update versions.ts, synth cdk8s, push Helm charts, sync ArgoCD.

```bash
ci-local --dry-run homelab-deploy --target scout        # deploy scout-beta + scout-prod
ci-local --dry-run homelab-deploy --target tasks        # deploy tasknotes
ci-local --dry-run homelab-deploy --target birmel --skip-images   # re-push chart only
ci-local --dry-run homelab-deploy --all                 # everything
```

| Flag | Description |
|------|-------------|
| `--target NAME [NAME...]` | Target names or aliases |
| `--all` | Deploy all 30 targets |
| `--skip-images` | Skip image push and versions.ts update |
| `--skip-helm` | Skip Helm chart push |
| `--skip-argocd` | Skip ArgoCD sync |
| `--auto-commit` | Commit versions.ts changes (does not push) |
| `--wait-healthy` | Poll ArgoCD until apps report Healthy |

**Env vars**: `GH_TOKEN`, `CHARTMUSEUM_USERNAME`, `CHARTMUSEUM_PASSWORD`, `ARGOCD_AUTH_TOKEN`

**Steps executed** (in order):
1. Resolve targets (expand aliases, map to images/charts/argo apps)
2. Push container images via `bazel run --stamp`, store digests
3. Update `packages/homelab/src/cdk8s/src/versions.ts` with new digests
4. Run `bun run build` in `packages/homelab/src/cdk8s` (full cdk8s synthesis)
5. Package and push only the resolved Helm charts to ChartMuseum
6. Sync only the resolved ArgoCD apps
7. (optional) Wait for healthy, auto-commit

### `image-push`

Push specific container images to GHCR.

```bash
ci-local --dry-run image-push --target birmel sentinel
```

| Flag | Description |
|------|-------------|
| `--target NAME [NAME...]` | Image names (13 available: 9 app + 4 infra) |

**Env vars**: `GH_TOKEN`

### `helm-push`

Package and push Helm charts to ChartMuseum.

```bash
ci-local --dry-run helm-push --target scout-beta apps
```

| Flag | Description |
|------|-------------|
| `--target NAME [NAME...]` | Chart names (29 available) |

**Env vars**: `CHARTMUSEUM_USERNAME`, `CHARTMUSEUM_PASSWORD`

### `argocd-sync`

Trigger ArgoCD sync for specific applications.

```bash
ci-local --dry-run argocd-sync --app birmel --wait-healthy
```

| Flag | Description |
|------|-------------|
| `--app NAME [NAME...]` | ArgoCD application names |
| `--wait-healthy` | Poll until Healthy |
| `--timeout SECONDS` | Health check timeout (default: 300) |

**Env vars**: `ARGOCD_AUTH_TOKEN`

### `tofu-apply`

Apply OpenTofu infrastructure stacks.

```bash
ci-local --dry-run tofu-apply --target cloudflare
```

| Flag | Description |
|------|-------------|
| `--target NAME [NAME...]` | Stack names: `cloudflare`, `github`, `seaweedfs` |

### `site-deploy`

Build and deploy static sites to S3 (SeaweedFS) or R2 (Cloudflare).

```bash
ci-local --dry-run site-deploy --target sjer.red webring
```

| Flag | Description |
|------|-------------|
| `--target NAME [NAME...]` | Site names (6 available) |

**Env vars**: `SEAWEEDFS_ACCESS_KEY_ID`, `SEAWEEDFS_SECRET_ACCESS_KEY` (for S3 targets); `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY` (for R2)

### `cooklang-release`

Build the cooklang-for-obsidian plugin, push to the separate repo, create GitHub release.

```bash
ci-local --dry-run cooklang-release --version 2.0.0
ci-local cooklang-release --version 2.0.0 --confirm      # for real
```

| Flag | Description |
|------|-------------|
| `--version VERSION` | Release version (required) |
| `--confirm` | Required for non-dry-run (pushes to external repo) |
| `--token TOKEN` | GitHub token override |

**Env vars**: `GH_TOKEN` (or `--token`, or `gh auth token`)

### `clauderon-release`

Build clauderon binaries and upload to GitHub release.

```bash
ci-local --dry-run clauderon-release --version 1.0.0                  # native only
ci-local --dry-run clauderon-release --version 1.0.0 --all-targets    # cross-compile Linux
```

| Flag | Description |
|------|-------------|
| `--version VERSION` | Release version (required) |
| `--all-targets` | Cross-compile for Linux x86_64 + arm64 (requires `cross`) |

**Env vars**: `GH_TOKEN` (or `gh auth token`)

### `tag-release`

Create a git tag and GitHub release.

```bash
ci-local --dry-run tag-release --tag v1.2.3
```

| Flag | Description |
|------|-------------|
| `--tag NAME` | Tag name (required) |

**Env vars**: `GH_TOKEN` or `GH_TOKEN`

### `npm-publish`

Publish NPM packages.

```bash
ci-local --dry-run npm-publish --target bun-decompile
```

| Flag | Description |
|------|-------------|
| `--target NAME [NAME...]` | Package names (4 available) |

**Env vars**: `NPM_TOKEN`

### `version`

Print current version info. No flags.

### `list-targets`

Print all available targets grouped by category. No flags.

## Target System

### Aliases

Aliases expand to multiple concrete targets:

| Alias | Expands to |
|-------|------------|
| `scout` | `scout-beta`, `scout-prod` |
| `tasks` | `tasknotes` |
| `karma` | `starlight-karma-bot-beta`, `starlight-karma-bot-prod` |

### Deploy Targets

Each deploy target maps a logical name to its images, Helm charts, and ArgoCD apps. For `homelab-deploy`, the CLI resolves which images to push, which charts to package, and which ArgoCD apps to sync.

Targets with custom images push those images first, then update `versions.ts` with the digest before synthesis. Targets without images (chart-only) just push the chart and sync.

Notable mappings:
- `tasknotes` pushes **two** images: `tasknotes-server` + `obsidian-headless`
- `pokemon` pushes the `discord-plays-pokemon` image
- `home` pushes the `homelab` infra image
- `s3-static-sites` pushes the `caddy-s3proxy` infra image
- `dependency-summary` pushes its image but routes to the `apps` chart (the CronJob lives there)
- `scout-prod` and `starlight-karma-bot-prod` have no images (promoted via Renovate, not CI push)

Run `ci-local list-targets` for the full mapping.

## Version Generation

When no `--version` is specified, the CLI auto-generates:

```
1.1.<max_patch + 1>-local.<YYYYMMDDHHMMSS>
```

It parses `packages/homelab/src/cdk8s/src/versions.ts` for the highest `1.1.X` patch across `shepherdjerred/*` entries. The `-local` prerelease suffix sorts below real CI versions in semver, so local versions never shadow production.

## Dry-Run Mode

`--dry-run` intercepts all side effects:

- **Subprocess calls** print `[DRY RUN] <command>` instead of executing
- **HTTP requests** print `[DRY RUN] POST <url>` instead of sending
- **File writes** (versions.ts) show what would change but don't write
- **Env var checks** are skipped (no credentials needed)

Dry-run is implemented at the library level via `ci.lib.runner`, so the output shows the actual commands that would run, including full bazel flags and ChartMuseum URLs.

## Caveats

- **Auto-commit does not push.** `--auto-commit` runs `git add` + `git commit` on the current branch. You must `git push` manually.
- **clauderon cross-compile requires `cross`.** Default builds only the native target (e.g. `aarch64-apple-darwin` on Apple Silicon). `--all-targets` needs [cross-rs](https://github.com/cross-rs/cross) installed.
- **cooklang-release pushes to an external repo.** It commits directly to `main` of `shepherdjerred/cooklang-for-obsidian`. Use `--dry-run` first, then `--confirm` for real runs.
- **cdk8s synthesis is always full-app.** Even targeted deploys synthesize all charts. Only the chart push and ArgoCD sync are scoped to the selected targets.
- **`--skip-images` also skips versions.ts update.** No fresh digests means nothing to write.
- **Staging directory is ephemeral.** Metadata and artifacts for a run are stored in a temp directory (`MONOREPO_CI_RUN_DIR`). They are not persisted across runs.

## Keeping It Maintained

### Adding a new service

When adding a new Kubernetes service, update `scripts/ci/src/ci/lib/catalog.py`:

1. If the service has a container image, add it to `IMAGE_PUSH_TARGETS` or `INFRA_PUSH_TARGETS`
2. Add the chart name to `HELM_CHARTS`
3. Add a `DeployTarget` entry in `_build_deploy_targets()` mapping the name to its images, charts, and ArgoCD apps
4. If the image digest should be tracked in versions.ts, add the version key to `VERSION_KEYS`
5. (Optional) Add an alias to `ALIASES` if the name has stage variants

The `pipeline_generator.py` and `homelab_helm_push.py` both import from `catalog.py`, so no other files need updating for the target lists.

### Adding a new alias

Add to the `ALIASES` dict in `catalog.py`. Ensure each expanded name exists in `DEPLOY_TARGETS`.

### Verifying after changes

```bash
cd scripts/ci
uv run --extra dev pytest tests/ -v   # 84 tests, includes catalog integrity checks
uv run ci-local list-targets           # visual check
uv run ci-local --dry-run homelab-deploy --target <new-target>
```

The `test_catalog.py` tests verify that `VERSION_KEYS` matches all push targets, that every `HELM_CHART` has a `DEPLOY_TARGET`, and that all aliases resolve to valid targets. These will catch common mistakes.

## Implementation

Key source files:

| File | Purpose |
|------|---------|
| `scripts/ci/src/ci/local.py` | CLI entry point, argparse setup, command dispatch |
| `scripts/ci/src/ci/lib/catalog.py` | All target catalogs, aliases, `DeployTarget` mapping |
| `scripts/ci/src/ci/lib/config.py` | `ReleaseConfig.for_local()`, version generation |
| `scripts/ci/src/ci/lib/runner.py` | Dry-run-aware subprocess/HTTP wrappers |
| `scripts/ci/src/ci/lib/buildkite.py` | Metadata and artifact storage (Buildkite agent or local JSON) |
| `scripts/ci/src/ci/local_commands/*.py` | 12 command modules |
| `scripts/ci/pyproject.toml` | `[project.scripts]` entry point: `ci-local = "ci.local:main"` |
