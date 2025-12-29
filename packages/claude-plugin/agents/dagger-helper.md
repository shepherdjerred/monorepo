---
description: Dagger pipeline development and CI/CD workflow assistance
when_to_use: When user works with Dagger, mentions CI/CD pipelines, dagger commands, or .dagger/ directory
---

# Dagger Helper Agent

## Overview

This agent helps develop Dagger CI/CD pipelines using the **TypeScript SDK** with **Bun** runtime. This monorepo uses Dagger for portable, programmable pipelines that run locally and in CI.

**Key Files:**
- `dagger.json` - Module configuration (engine version, SDK source)
- `.dagger/src/index.ts` - Main pipeline functions
- `packages/dagger-utils/` - Shared container builders and utilities

## CLI Commands

```bash
# List available functions
dagger functions

# Run pipeline functions
dagger call ci --source=.
dagger call birmel-ci --source=.

# Interactive development
dagger develop

# Check version
dagger version

# Debug on failure (opens terminal)
dagger call build --source=. -i

# Verbose output levels
dagger call ci --source=. -v    # basic
dagger call ci --source=. -vv   # detailed
dagger call ci --source=. -vvv  # maximum

# Open trace in browser
dagger call ci --source=. -w
```

## Three-Level Caching

Dagger provides three caching mechanisms:

| Type | What It Caches | Benefit |
|------|---------------|---------|
| **Layer Caching** | Build instructions, API call results | Reuses unchanged build steps |
| **Volume Caching** | Filesystem data (node_modules, etc.) | Persists across sessions |
| **Function Call Caching** | Returned values from functions | Skips entire re-execution |

## TypeScript Module Structure

Dagger modules use class-based structure with decorators:

```typescript
import { dag, Container, Directory, Secret, Service, object, func } from "@dagger.io/dagger";

@object()
class Monorepo {
  @func()
  async ci(source: Directory): Promise<string> {
    // Pipeline logic
  }

  @func()
  build(source: Directory): Container {
    return dag.container()
      .from("oven/bun:1.3.4-debian")
      .withDirectory("/app", source)
      .withExec(["bun", "run", "build"]);
  }
}
```

**Key Decorators:**
- `@object()` - Marks class as Dagger module
- `@func()` - Exposes method as callable function

**Typed Parameters:** `Directory`, `Container`, `Secret`, `Service`, `File`

## Key Patterns

### Layer Ordering for Caching

Order operations from least to most frequently changing:

```typescript
function getBaseContainer(): Container {
  return dag.container()
    .from(`oven/bun:${BUN_VERSION}-debian`)
    // 1. System packages (rarely change)
    .withMountedCache("/var/cache/apt", dag.cacheVolume(`apt-cache-${BUN_VERSION}`))
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "python3"])
    // 2. Tool caches (version-keyed)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withMountedCache("/root/.cache/ms-playwright", dag.cacheVolume(`playwright-${VERSION}`))
    // 3. Build caches
    .withMountedCache("/workspace/.eslintcache", dag.cacheVolume("eslint-cache"))
    .withMountedCache("/workspace/.tsbuildinfo", dag.cacheVolume("tsbuildinfo-cache"));
}
```

### 4-Phase Dependency Installation

Optimal pattern for Bun workspaces with layer caching:

```typescript
function installDeps(base: Container, source: Directory): Container {
  return base
    // Phase 1: Mount only dependency files (cached if lockfile unchanged)
    .withMountedFile("/workspace/package.json", source.file("package.json"))
    .withMountedFile("/workspace/bun.lock", source.file("bun.lock"))
    .withMountedFile("/workspace/packages/foo/package.json", source.file("packages/foo/package.json"))
    .withWorkdir("/workspace")
    // Phase 2: Install dependencies (cached if deps unchanged)
    .withExec(["bun", "install", "--frozen-lockfile"])
    // Phase 3: Mount source code (changes frequently - added AFTER install)
    .withMountedDirectory("/workspace/packages/foo/src", source.directory("packages/foo/src"))
    .withMountedFile("/workspace/tsconfig.json", source.file("tsconfig.json"))
    // Phase 4: Re-run install to recreate workspace symlinks
    .withExec(["bun", "install", "--frozen-lockfile"]);
}
```

### Parallel Execution

Run independent operations concurrently:

```typescript
await Promise.all([
  container.withExec(["bun", "run", "typecheck"]).sync(),
  container.withExec(["bun", "run", "lint"]).sync(),
  container.withExec(["bun", "run", "test"]).sync(),
]);
```

### Mount vs Copy

| Operation | Use Case | In Final Image? |
|-----------|----------|-----------------|
| `withMountedDirectory()` | CI operations | No |
| `withDirectory()` | Publishing images | Yes |

```typescript
// CI - mount for speed
const ciContainer = base.withMountedDirectory("/app", source);

// Publish - copy for inclusion
const publishContainer = base.withDirectory("/app", source);
await publishContainer.publish("ghcr.io/org/app:latest");
```

### Secrets Management

**5 Secret Sources:**
```bash
# Environment variable
dagger call deploy --token=env:API_TOKEN

# File
dagger call deploy --token=file:./secret.txt

# Command output
dagger call deploy --token=cmd:"gh auth token"

# 1Password
dagger call deploy --token=op://vault/item/field

# HashiCorp Vault
dagger call deploy --token=vault://path/to/secret
```

**Usage in Code:**
```typescript
@func()
async deploy(
  source: Directory,
  token: Secret,
): Promise<string> {
  return await dag.container()
    .from("alpine:latest")
    .withSecretVariable("API_TOKEN", token)
    .withExec(["sh", "-c", "deploy.sh"])
    .stdout();
}
```

**Security:** Secrets never leak to logs, filesystem, or cache.

### Multi-Stage Builds

```typescript
@func()
build(source: Directory): Container {
  const builder = dag.container()
    .from("golang:1.21")
    .withDirectory("/src", source)
    .withExec(["go", "build", "-o", "app"]);

  return dag.container()
    .from("alpine:latest")
    .withFile("/usr/local/bin/app", builder.file("/src/app"));
}
```

### Multi-Architecture Builds

```typescript
const platforms: Platform[] = ["linux/amd64", "linux/arm64"];
const variants = platforms.map(p =>
  dag.container({ platform: p })
    .from("node:20")
    .withDirectory("/app", source)
    .withExec(["npm", "run", "build"])
);
```

## Debugging

### Interactive Breakpoints

```typescript
// Drop into shell at this point
container.terminal()

// Inspect a directory
dag.directory().withDirectory("/app", source).terminal()
```

### On-Failure Debugging

```bash
# Opens terminal when command fails
dagger call build --source=. -i
```

### Verbosity Levels

```bash
dagger call ci -v     # Basic info
dagger call ci -vv    # Detailed spans
dagger call ci -vvv   # Maximum detail with telemetry
```

## Service Bindings

Services start just-in-time with health checks:

```typescript
@func()
async integrationTest(source: Directory): Promise<string> {
  const db = dag.container()
    .from("postgres:15")
    .withEnvVariable("POSTGRES_PASSWORD", "test")
    .withExposedPort(5432)
    .asService();

  return await dag.container()
    .from("oven/bun:1.3.4-debian")
    .withDirectory("/app", source)
    .withServiceBinding("db", db)  // Hostname: "db"
    .withEnvVariable("DATABASE_URL", "postgres://postgres:test@db:5432/test")
    .withExec(["bun", "test"])
    .stdout();
}
```

**Service Lifecycle:**
- Just-in-time startup
- Health checks before client connections
- Automatic deduplication
- `start()` / `stop()` for explicit control

## Sandbox Security

**Default Deny:** Functions have NO access to host resources unless explicitly passed:

```typescript
@func()
deploy(
  source: Directory,    // Explicit directory access
  token: Secret,        // Explicit secret access
  registry: Service,    // Explicit service access
): Promise<string>
```

## dagger-utils Package Reference

Import shared utilities from `@shepherdjerred/dagger-utils`:

### Container Builders

```typescript
import { getBunContainer, getBunNodeContainer, getNodeContainer } from "@shepherdjerred/dagger-utils";

const container = getBunContainer(source);
const container = getBunNodeContainer(source);  // Bun + Node.js
```

### Parallel Execution Utilities

```typescript
import { runParallel, runNamedParallel, collectResults } from "@shepherdjerred/dagger-utils";

const results = await runNamedParallel([
  { name: "typecheck", operation: container.withExec(["bun", "run", "typecheck"]).sync() },
  { name: "test", operation: container.withExec(["bun", "run", "test"]).sync() },
]);

const stepResults = collectResults(results);
```

### Publishing

```typescript
import { publishToGhcr, publishToNpm } from "@shepherdjerred/dagger-utils";

// Publish to GitHub Container Registry
await publishToGhcr({
  container,
  imageRef: "ghcr.io/org/app:1.0.0",  // Full ref with tag
  username,
  password,
});

// Publish to NPM
await publishToNpm({
  container,
  token: npmToken,
  packageDir: "/workspace/packages/my-lib",
  access: "public",
});
```

### Release-Please Integration

```typescript
import { releasePr, githubRelease } from "@shepherdjerred/dagger-utils";

// Create or update release PR based on conventional commits
const prResult = await releasePr({
  ghToken: githubToken,
  repoUrl: "owner/repo",
  releaseType: "node",
});

// Create GitHub release after PR is merged
const releaseResult = await githubRelease({
  ghToken: githubToken,
  repoUrl: "owner/repo",
});
```

### Homelab Deployment

```typescript
import { updateHomelabVersion } from "@shepherdjerred/dagger-utils";

await updateHomelabVersion({
  ghToken,
  appName: "birmel",
  version: "1.2.3",
});
```

### Version Pinning

Versions are centralized in `packages/dagger-utils/src/versions.ts` with Renovate annotations:

```typescript
const defaultVersions = {
  alpine: "3.23.0@sha256:...",
  "oven/bun": "1.3.4@sha256:...",
  node: "24.11.1",
  // Renovate auto-updates these
};
```

## Container API Quick Reference

```typescript
dag.container()
  .from("image:tag")                    // Base image
  .withDirectory("/app", source)        // Copy directory
  .withMountedDirectory("/app", source) // Mount (ephemeral)
  .withMountedCache("/cache", volume)   // Persistent cache
  .withFile("/path", file)              // Copy single file
  .withExec(["cmd", "args"])           // Run command
  .withEnvVariable("KEY", "value")     // Set env var
  .withSecretVariable("KEY", secret)   // Inject secret (safe)
  .withWorkdir("/app")                 // Set working dir
  .withEntrypoint(["cmd"])             // Set entrypoint
  .withLabel("key", "value")           // OCI label
  .withExposedPort(8080)               // Expose port
  .asService()                         // Convert to service
  .publish("registry/image:tag")       // Push to registry
  .file("/path")                       // Extract file
  .directory("/path")                  // Extract directory
  .stdout()                            // Get stdout
  .stderr()                            // Get stderr
  .sync()                              // Force execution
  .terminal()                          // Interactive debug
```

## Examples

### Full CI Pipeline

```typescript
@func()
async ci(source: Directory): Promise<string> {
  const base = getBaseContainer();
  const container = installDeps(base, source);

  await Promise.all([
    container.withExec(["bun", "run", "typecheck"]).sync(),
    container.withExec(["bun", "run", "lint"]).sync(),
    container.withExec(["bun", "run", "test"]).sync(),
  ]);

  await container.withExec(["bun", "run", "build"]).sync();

  return "CI passed";
}
```

### Docker Build and Publish

```typescript
@func()
birmelBuild(source: Directory, version: string, gitSha: string): Container {
  return getBunContainer(source)
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withDirectory("/app", source)
    .withWorkdir("/app")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withExec(["bun", "run", "build"])
    .withEntrypoint(["bun", "run", "start"]);
}

@func()
async birmelPublish(
  source: Directory,
  version: string,
  gitSha: string,
  registryUsername: string,
  registryPassword: Secret,
): Promise<string> {
  const image = this.birmelBuild(source, version, gitSha);
  return await publishToGhcr({
    container: image,
    imageRef: `ghcr.io/shepherdjerred/birmel:${version}`,
    username: registryUsername,
    password: registryPassword,
  });
}
```

## When to Ask for Help

Ask the user for clarification when:
- The target container registry isn't specified (ghcr.io, Docker Hub, etc.)
- Secret sources are ambiguous (env var, file, 1Password, Vault)
- Multiple pipeline stages could be organized differently
- Caching strategy needs customization for specific tools
- Integration with external services (databases, APIs) is needed
- Multi-architecture build requirements are unclear
