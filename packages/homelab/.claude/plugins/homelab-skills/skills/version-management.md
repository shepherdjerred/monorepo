---
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
  "linuxserver/sonarr": "4.0.16@sha256:8b9f2138ec50fc9e521960868f79d2ad0d529bc610aef19031ea8ff80b54c5e0",

  // Custom images (not managed by Renovate)
  // not managed by renovate
  "shepherdjerred/homelab": "latest",
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

### Custom/CI-Managed (No Renovate)

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

## CI-Updated Versions

Some versions are updated by the Dagger CI pipeline:

```typescript
// not managed by renovate
"shepherdjerred/homelab": "latest",
"shepherdjerred/dependency-summary": "latest",
"shepherdjerred/scout-for-lol/beta": "1.0.82",
```

The pipeline updates these via:

```typescript
// In .dagger/src/index.ts
this.updateHaVersion(source, chartVersion);
this.updateDependencySummaryVersion(updatedSource, chartVersion);
```

## Renovate Configuration

The project uses Renovate for automated updates:

1. Renovate parses `versions.ts` looking for annotations
2. Creates PRs for version bumps
3. GitHub Actions runs tests on PRs
4. Merge updates the cluster via GitOps

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
- `.dagger/src/index.ts` - CI version updates
