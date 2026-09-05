---
name: version-management
description: >-
  Use when asking about version management, Renovate annotations,
  the version catalog, or pinning image/chart versions.
---

# Version Management

## Overview

`packages/version-catalog/src/catalog.json` is the language-neutral source of
truth for homelab and release-script versions. Its adjacent JSON Schema is the
portable contract, and `@shepherdjerred/version-catalog` provides the shared
Zod parser and canonical serializer. CDK8s consumes that package from
`src/cdk8s/src/versions.ts` and adds only its generated exact-key type boundary
plus build-time image overrides.

## File Structure

```json
{
  "$schema": "./schema.json",
  "schemaVersion": 1,
  "entries": [
    {
      "name": "argo-cd",
      "value": "10.2.1",
      "category": "upstream",
      "artifactType": "helm-chart",
      "management": {
        "managed": true,
        "datasource": "helm",
        "registryUrl": "https://argoproj.github.io/argo-helm",
        "versioning": "semver"
      }
    }
  ]
}
```

## Adding a New Version

### Helm Chart

```json
{
  "name": "mychart",
  "value": "1.2.3",
  "category": "upstream",
  "artifactType": "helm-chart",
  "management": {
    "managed": true,
    "datasource": "helm",
    "registryUrl": "https://charts.example.com",
    "versioning": "semver"
  }
}
```

### Docker Image (with digest)

```json
{
  "name": "org/image",
  "value": "1.0.0@sha256:abc123def456...",
  "category": "upstream",
  "artifactType": "image",
  "management": {
    "managed": true,
    "datasource": "docker",
    "registryUrl": "https://ghcr.io",
    "versioning": "docker"
  }
}
```

### Docker Hub Image

Use the Docker-image shape above with `registryUrl` set to
`https://docker.io`.

### GitHub Release

Use `artifactType: "source"`, `datasource: "github-releases"`, and the
repository name in `name` or `packageName`.

### Custom/Manually-Managed (No Renovate)

```json
{
  "name": "myorg/custom-image",
  "value": "latest",
  "category": "internal-image",
  "artifactType": "image",
  "management": { "managed": false }
}
```

## Renovate Annotation Format

Renovate's custom manager reads `management.datasource`, `versioning`, optional
`registryUrl`, and optional `packageName` directly from each JSON entry. Do not
add TypeScript Renovate comments or edit the generated CDK8s projection.

### Datasources

| Datasource        | Use For           |
| ----------------- | ----------------- |
| `helm`            | Helm charts       |
| `docker`          | Container images  |
| `github-releases` | GitHub releases   |
| `custom.papermc`  | Custom registries |

### Registry URLs

| Registry                  | URL                 |
| ------------------------- | ------------------- |
| Docker Hub                | `https://docker.io` |
| GitHub Container Registry | `https://ghcr.io`   |
| Quay.io                   | `https://quay.io`   |
| Helm chart repos          | Chart-specific URL  |

### Versioning Schemes

| Scheme   | Use For                     |
| -------- | --------------------------- |
| `semver` | Semantic versioning (1.2.3) |
| `docker` | Docker tag conventions      |
| `loose`  | Non-standard versions       |

## Usage in Code

### Container Images

```typescript
import versions from "../versions.ts";

deployment.addContainer({
  image: `ghcr.io/linuxserver/sonarr:${versions["linuxserver/sonarr"]}`,
});
```

### Helm Charts

```typescript
import versions from "../../versions.ts";

new Application(chart, "myapp", {
  spec: {
    source: {
      targetRevision: versions["myapp"],
      chart: "myapp",
    },
  },
});
```

## SHA256 Digests

Always include digests for production images. The digest lives in the entry's
`value`, appended to the tag:

```json
// Good: Immutable reference
{ "name": "org/image", "value": "1.0.0@sha256:abc123..." }

// Avoid: Mutable tag
{ "name": "org/image", "value": "1.0.0" }
```

**Benefits:**

- Immutable deployments
- Reproducible builds
- Security (prevents tag mutation attacks)

**Getting the digest:**

```bash
# Using crane
crane digest ghcr.io/org/image:1.0.0

# Using docker
docker pull ghcr.io/org/image:1.0.0
docker inspect ghcr.io/org/image:1.0.0 --format='{{index .RepoDigests 0}}'
```

## Talos / Kubernetes Pins Reflect Deployed Reality

The `kubernetes/kubernetes` and `siderolabs/talos` entries in
`packages/version-catalog/src/catalog.json` must match the version **actually
deployed and running on `torvalds`** — not whatever upstream Renovate would bump
to. These two are not consumed by code; they exist for Renovate to track AND as
a source-of-truth record of cluster state.

After any `talosctl upgrade` or `talosctl upgrade-k8s` that lands on a version
different from the existing pin (e.g. the Sidero kubelet image for the latest
patch isn't published yet, so you pick the prior k8s patch), edit that entry's
`value` in the catalog **and** the README upgrade snippet
(`packages/homelab/README.md` `VERSION=` example lines) to the now-running
version in the same change. Both entries are `artifactType: "source"` with the
`github-releases` datasource:

```json
{
  "name": "siderolabs/talos",
  "category": "upstream",
  "artifactType": "source",
  "management": {
    "managed": true,
    "datasource": "github-releases",
    "versioning": "semver"
  },
  "value": "1.13.8"
}
```

If they drift from reality, future upgrade sessions can't tell a Renovate target
from a record of what's deployed.

## First-Party Image Versions (automated by version commit-back)

First-party image entries are rewritten by the replatformed static Buildkite
pipeline (`.buildkite/pipeline.yml`, landed 2026-07 after the old Dagger CI was
removed): the `images` step bakes/pushes images (tags `:$GIT_SHA` + `:latest`;
the `2.0.0-<build>` in a pin is a cosmetic label on a digest-pinned ref) and
records **content-gated** digests, and the `version commit-back` step
(`scripts/release/update-versions.ts --commit-back`) opens the auto-merge
"chore: bump pending image versions" PR rewriting the matching catalog entries:

```json
{
  "name": "shepherdjerred/temporal-worker",
  "category": "internal-image",
  "artifactType": "image",
  "management": { "managed": false },
  "value": "2.0.0-1020@sha256:…",
  "notes": ["not managed by renovate"]
}
```

Commit-back rewrites only the `value` of bare-name and `/beta` stage entries —
never `/prod`. It writes through the catalog's canonical serializer, so hand
edits to the same entries should keep the existing field order.

### `/beta` and `/prod` are deployment-stage keys, not image names

App images publish to a **single** GHCR package (e.g.
`ghcr.io/shepherdjerred/scout-for-lol:2.0.0-710`) — there is no `/beta` or
`/prod` in the image name. The catalog carries separate `…/beta` and `…/prod`
entries because they are deployment stages that may pin different versions:

```json
// beta tracks latest (auto-bumped by version commit-back)
{ "name": "shepherdjerred/scout-for-lol/beta", "value": "2.0.0-710@sha256:…" }
// prod promoted explicitly by merging the Renovate PR
{ "name": "shepherdjerred/scout-for-lol/prod", "value": "2.0.0-700@sha256:…" }
```

A `/prod` entry keeps `management.packageName` pointed at the suffix-free image
so Renovate resolves the real GHCR package. The build target's `versionKey`
(used in `--tags ghcr.io/{versionKey}:…`) must **not** carry a `/beta`|`/prod`
suffix; only the catalog entry names and the cdk8s resources that read the
projection use the stage suffixes to deploy a different version per stage.

### First-party prod pins are Renovate promotions (minted release tags)

`shepherdjerred/scout-for-lol/prod` and `shepherdjerred/starlight-karma-bot/prod`
carry Renovate annotations (docker datasource) and are promoted by **merging
the Renovate PR** — the "Prod images" packageRule pins them to
`automerge: false`. Renovate can only offer tags CI minted:

- **scout:** the `scout-tag-release` pipeline step mints
  `ghcr.io/shepherdjerred/scout-for-lol:2.0.0-<n>` only after site version
  `<n>` is archived, pointing at the backend digest beta serves it against —
  each tag is an atomic backend+site release pair. There is **no separate
  site pin**: `scout-prod-reconcile` derives the prod site version from the
  pin's tag portion, so one pin moves both halves in lockstep (the tRPC-skew
  guarantee lives in the tag mint, not in paired pins).
- **starlight-karma-bot:** `bake-images.sh` pushes a `2.0.0-<build>` tag
  whenever a content change records a digest.

Rollback = `git revert` the promotion merge, or hand-edit the pin to any
older **minted** tag@digest. Never pin a tag CI didn't mint or hand-pair a
tag with a different digest. See `packages/scout-for-lol/AGENTS.md` § Stage
deploys.

## Renovate Configuration

The project uses Mend-hosted Renovate as a dashboard-first dependency inventory:

1. Renovate's custom manager parses structured entries in `catalog.json`
2. Renovate reports available updates in the GitHub Dependency Dashboard
3. A human selects a dashboard checkbox to authorize a branch and PR for one update
4. Humans rebase and merge approved PRs; Renovate never does either automatically
5. PRs run `bun run verify` (affected-scoped) on the static Buildkite pipeline (`.buildkite/pipeline.yml`) — check the `buildkite/monorepo/pr` status before merging

Renovate vulnerability remediation and OSV alerts are disabled so they cannot
bypass dashboard approval. GitHub's separate security-alert interface is
unchanged. Approved Bun updates still run a full install, so
`BUN_CONFIG_MAX_HTTP_REQUESTS=4` limits their HTTP concurrency for the
Mend-hosted 3 GB runner. Validate the repository configuration against Mend's
exact Renovate version and environment allowlist:

```bash
RENOVATE_ALLOWED_ENV='["BUN_CONFIG_MAX_HTTP_REQUESTS"]' \
  bunx --package renovate@44.39.0 \
  renovate-config-validator --no-global renovate.json
```

### Digest/pin updates bypass `minimumReleaseAge`

`minimumReleaseAge` + `internalChecksFilter: strict` only hold back **major/minor/patch** PRs (Dependency Dashboard "Pending Status Checks"); they do **not** apply to `digest` / `pinDigest` / `pin` updates, which open immediately and would otherwise merge before the window. The Buildkite stability guard that used to block these (`renovateStabilityPending()` in the CI generator) was removed with the pipeline 2026-07 — check the `renovate/stability-days` status yourself before merging a digest/pin PR. Escape hatch for a fast-moving digest: a `minimumReleaseAge: "0 days"` packageRule. Validate configuration with `bunx --package renovate renovate-config-validator renovate.json`.

### Never silence upstream-blocked items

Do **not** add `packageRules` with `enabled: false` to `renovate.json` to suppress dashboard items that are blocked by an upstream peer/compat issue. Silencing hides a live constraint (same failure mode as swallowing exceptions) and requires remembering to remove the rule later. Instead, leave the item surfaced, document the block and its unblock condition in Linear, and re-probe each session until it clears. "Blocked for months" is not a reason to silence — a still-blocked dashboard is correctly reporting reality.

## Best Practices

1. **Declare management metadata** for external dependencies
2. **Include SHA256 digests** for container images
3. **Use semantic versioning** when possible
4. **Mark internal images** as "not managed by renovate"
5. **Group related updates** (e.g., linuxserver images)

## Common Patterns

### Multiple Images from Same Org

Use one structured catalog entry per image with the same `datasource`,
`registryUrl`, and `versioning`. Renovate grouping remains in `renovate.json`;
do not collapse multiple artifacts into one catalog entry.

### Helm Chart with Custom Registry

Use a managed `helm-chart` entry with
`registryUrl: "https://charts.gitlab.io"` and `versioning: "semver"`.

## Key Files

- `packages/version-catalog/src/catalog.json` - writable version registry
- `packages/version-catalog/src/schema.json` - language-neutral contract
- `packages/version-catalog/src/index.ts` - shared parser and serializer
- `packages/homelab/src/cdk8s/src/versions.ts` - CDK8s runtime projection
- `renovate.json` - Renovate custom-manager configuration
