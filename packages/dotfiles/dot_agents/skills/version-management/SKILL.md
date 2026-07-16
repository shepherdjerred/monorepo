---
name: version-management
description: >-
  Use when asking about version management, Renovate annotations,
  versions.ts patterns, or pinning image/chart versions.
---

# Version Management

## Overview

`src/cdk8s/src/versions.ts` is the single source of truth for all versions in the homelab. It uses Renovate annotations for automated dependency updates.

## File Structure

```typescript
const versions = {
  // Helm charts
  // renovate: datasource=helm registryUrl=https://argoproj.github.io/argo-helm versioning=semver
  "argo-cd": "9.2.0",

  // Docker images with digests
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/sonarr":
    "4.0.16@sha256:8b9f2138ec50fc9e521960868f79d2ad0d529bc610aef19031ea8ff80b54c5e0",

  // Custom images (not managed by Renovate)
  // not managed by renovate
  "shepherdjerred/temporal-worker": "latest",
};

export default versions;
```

## Adding a New Version

### Helm Chart

```typescript
// renovate: datasource=helm registryUrl=https://charts.example.com versioning=semver
"mychart": "1.2.3",
```

### Docker Image (with digest)

```typescript
// renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
"org/image": "1.0.0@sha256:abc123def456...",
```

### Docker Hub Image

```typescript
// renovate: datasource=docker registryUrl=https://docker.io versioning=docker
"library/nginx": "1.25.0@sha256:...",
```

### GitHub Release

```typescript
// renovate: datasource=github-releases versioning=semver
"owner/repo": "v1.2.3",
```

### Custom/Manually-Managed (No Renovate)

```typescript
// not managed by renovate
"myorg/custom-image": "latest",
```

## Renovate Annotation Format

```text
// renovate: datasource={source} registryUrl={url} versioning={scheme}
```

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

Always include digests for production images:

```typescript
// Good: Immutable reference
"org/image": "1.0.0@sha256:abc123...",

// Avoid: Mutable tag
"org/image": "1.0.0",
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

The `"kubernetes/kubernetes"` and `"siderolabs/talos"` entries in `versions.ts` must match the version **actually deployed and running on `torvalds`** — not whatever upstream Renovate would bump to. These two are not consumed by code; they exist for Renovate to track AND as a source-of-truth record of cluster state.

After any `talosctl upgrade` or `talosctl upgrade-k8s` that lands on a version different from the existing pin (e.g. the Sidero kubelet image for the latest patch isn't published yet, so you pick the prior k8s patch), update `versions.ts` **and** the README upgrade snippet (`packages/homelab/README.md` `VERSION=` example lines) to the now-running version in the same change. If they drift from reality, future upgrade sessions can't tell a Renovate target from a record of what's deployed.

## First-Party Image Versions (manual since 2026-07)

First-party image entries used to be rewritten by the Dagger/Buildkite CI pipeline (removed 2026-07)
after each image push (tag `2.0.0-$BUILDKITE_BUILD_NUMBER` + digest); image builds/pushes
and the matching `versions.ts` updates are now manual:

```typescript
// not managed by renovate
"shepherdjerred/temporal-worker":
  "2.0.0-1020@sha256:…",
"shepherdjerred/scout-for-lol/beta": "1.0.82",
```

After manually pushing an image, capture the digest from the push output and
rewrite the matching entry in `packages/homelab/src/cdk8s/src/versions.ts` yourself.

### `/beta` and `/prod` are deployment-stage keys, not image names

App images publish to a **single** GHCR package (e.g. `ghcr.io/shepherdjerred/scout-for-lol:2.0.0-710`) — there is no `/beta` or `/prod` in the image name. But `versions.ts` has separate `…/beta` and `…/prod` entries because they are deployment stages that may pin different versions:

```typescript
"shepherdjerred/scout-for-lol/beta": "2.0.0-710@sha256:…", // beta tracks latest
"shepherdjerred/scout-for-lol/prod": "2.0.0-700@sha256:…", // prod may lag
```

The catalog's `versionKey` (used in `--tags ghcr.io/{versionKey}:…`) must **not** carry a `/beta`|`/prod` suffix; only the `versions.ts` entries and the cdk8s resources that read them use the stage suffixes to deploy a different version per stage.

## Renovate Configuration

The project uses Renovate for automated updates:

1. Renovate parses `versions.ts` looking for annotations
2. Creates PRs for version bumps
3. There is no CI on PRs (pipeline removed 2026-07) — verify the affected package manually before merging

### Digest/pin updates bypass `minimumReleaseAge`

`minimumReleaseAge` + `internalChecksFilter: strict` only hold back **major/minor/patch** PRs (Dependency Dashboard "Pending Status Checks"); they do **not** apply to `digest` / `pinDigest` / `pin` updates, which open immediately and would otherwise merge before the window. The Buildkite stability guard that used to block these (`renovateStabilityPending()` in the CI generator) was removed with the pipeline 2026-07 — check the `renovate/stability-days` status yourself before merging a digest/pin PR. Escape hatch for a fast-moving digest: a `minimumReleaseAge: "0 days"` packageRule. (`renovate-config-validator` segfaults under Bun — run via `npx --yes --package renovate -- renovate-config-validator renovate.json`.)

### Never silence upstream-blocked items

Do **not** add `packageRules` with `enabled: false` to `renovate.json` to suppress dashboard items that are blocked by an upstream peer/compat issue. Silencing hides a live constraint (same failure mode as swallowing exceptions) and requires remembering to remove the rule later. Instead, leave the item surfaced, document the block and its unblock condition in a tracking doc (`packages/docs/plans/*`), and re-probe each session until it clears. "Blocked for months" is not a reason to silence — a still-blocked dashboard is correctly reporting reality.

## Best Practices

1. **Always use annotations** for external dependencies
2. **Include SHA256 digests** for container images
3. **Use semantic versioning** when possible
4. **Mark internal images** as "not managed by renovate"
5. **Group related updates** (e.g., linuxserver images)

## Common Patterns

### Multiple Images from Same Org

```typescript
// renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
"linuxserver/sonarr": "4.0.16@sha256:...",
// renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
"linuxserver/radarr": "5.2.6@sha256:...",
// renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
"linuxserver/bazarr": "1.4.0@sha256:...",
```

### Helm Chart with Custom Registry

```typescript
// renovate: datasource=helm registryUrl=https://charts.gitlab.io versioning=semver
"gitlab": "7.8.0",
```

## Key Files

- `src/cdk8s/src/versions.ts` - Version registry
- `renovate.json` - Renovate configuration
