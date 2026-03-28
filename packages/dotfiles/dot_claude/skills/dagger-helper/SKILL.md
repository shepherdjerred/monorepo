---
name: dagger-helper
description: |
  Dagger pipeline development and CI/CD workflow assistance
  When user works with Dagger, mentions CI/CD pipelines, dagger commands, or .dagger/ directory
---

# Dagger Helper Agent

## Overview

This agent helps develop Dagger CI/CD pipelines using the **TypeScript SDK** with **Bun** runtime. This monorepo uses Dagger for portable, programmable pipelines that run locally and in CI.

**Key Files:**

- `dagger.json` - Module configuration (engine version, SDK source)
- `.dagger/src/index.ts` - Main pipeline functions

## CLI Commands

```bash
# List available functions
dagger functions

# Run pipeline functions (--source maps to a Directory param)
dagger call ci --source=.
dagger call birmel-ci --source=.

# Dagger Shell (v0.20) — interactive bash-syntax frontend
dagger                          # opens Dagger Shell by default

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

# Update dependencies
dagger update

# Uninstall a dependency
dagger uninstall <module>

# Open trace in browser
dagger call ci --source=. -w
```

**Supported Runtimes (0.19+):** docker, podman, nerdctl, finch, Apple containers — no Docker required.

## Three-Level Caching

Dagger provides three caching mechanisms:

| Type                      | What It Caches                       | Benefit                      |
| ------------------------- | ------------------------------------ | ---------------------------- |
| **Layer Caching**         | Build instructions, API call results | Reuses unchanged build steps |
| **Volume Caching**        | Filesystem data (node_modules, etc.) | Persists across sessions     |
| **Function Call Caching** | Returned values from functions       | Skips entire re-execution    |

## Monorepo: Avoid --source .

For per-package builds, never use `--source .` (syncs entire monorepo). Instead, use `ignore` annotations on `Directory` parameters to filter before transfer:

```typescript
@func()
async lint(
  @argument({ defaultPath: "/", ignore: ["*", "!packages/foo/**", "!tsconfig.json", "!bun.lock"] })
  source: Directory,
): Promise<string> { ... }
```

For repo-wide operations (prettier, shellcheck), `--source .` may still be appropriate. See `references/monorepo-performance.md` for multi-module architecture, cache debugging, remote cache, and Dagger Shell/Checks.

## TypeScript Module Structure

Dagger modules use class-based structure with decorators:

```typescript
import {
  dag,
  Container,
  Directory,
  Secret,
  Service,
  object,
  func,
} from "@dagger.io/dagger";

@object()
class Monorepo {
  @func()
  async ci(source: Directory): Promise<string> {
    // Pipeline logic
  }

  @func()
  build(source: Directory): Container {
    return dag
      .container()
      .from("oven/bun:1.3.4-debian")
      .withDirectory("/app", source)
      .withExec(["bun", "run", "build"]);
  }
}

// Enum declaration (registered when used by module)
export enum Status {
  Active = "Active",
  Inactive = "Inactive",
}

// Type object declaration
export type Message = { content: string };
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
  return (
    dag
      .container()
      .from(`oven/bun:${BUN_VERSION}-debian`)
      // 1. System packages (rarely change)
      .withMountedCache(
        "/var/cache/apt",
        dag.cacheVolume(`apt-cache-${BUN_VERSION}`),
      )
      .withExec(["apt-get", "update"])
      .withExec(["apt-get", "install", "-y", "python3"])
      // 2. Tool caches (version-keyed)
      .withMountedCache(
        "/root/.bun/install/cache",
        dag.cacheVolume("bun-cache"),
      )
      .withMountedCache(
        "/root/.cache/ms-playwright",
        dag.cacheVolume(`playwright-${VERSION}`),
      )
      // 3. Build caches
      .withMountedCache(
        "/workspace/.eslintcache",
        dag.cacheVolume("eslint-cache"),
      )
      .withMountedCache(
        "/workspace/.tsbuildinfo",
        dag.cacheVolume("tsbuildinfo-cache"),
      )
  );
}
```

### 4-Phase Dependency Installation

Optimal pattern for Bun workspaces with layer caching:

```typescript
function installDeps(base: Container, source: Directory): Container {
  return (
    base
      // Phase 1: Mount only dependency files (cached if lockfile unchanged)
      .withMountedFile("/workspace/package.json", source.file("package.json"))
      .withMountedFile("/workspace/bun.lock", source.file("bun.lock"))
      .withMountedFile(
        "/workspace/packages/foo/package.json",
        source.file("packages/foo/package.json"),
      )
      .withWorkdir("/workspace")
      // Phase 2: Install dependencies (cached if deps unchanged)
      .withExec(["bun", "install", "--frozen-lockfile"])
      // Phase 3: Mount source code (changes frequently - added AFTER install)
      .withMountedDirectory(
        "/workspace/packages/foo/src",
        source.directory("packages/foo/src"),
      )
      .withMountedFile("/workspace/tsconfig.json", source.file("tsconfig.json"))
      // Phase 4: Re-run install to recreate workspace symlinks
      .withExec(["bun", "install", "--frozen-lockfile"])
  );
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

| Operation                | Use Case          | In Final Image? | Content-Based Cache?                                          |
| ------------------------ | ----------------- | --------------- | ------------------------------------------------------------- |
| `withMountedDirectory()` | CI operations     | No              | No (BuildKit skips checksums unless read-only non-root mount) |
| `withDirectory()`        | Publishing images | Yes             | Yes (full content hash)                                       |

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
const variants = platforms.map((p) =>
  dag
    .container({ platform: p })
    .from("node:20")
    .withDirectory("/app", source)
    .withExec(["npm", "run", "build"]),
);
```

## CI Log Analysis

When reading Dagger CI logs (e.g. from `gh run view --log-failed`), these are **not true errors** and should be ignored:

- **Dagger Cloud token errors** (`401 Unauthorized`, `invalid API key` to `api.dagger.cloud`) — telemetry upload failures, does not affect the pipeline
- **GraphQL errors** (`Encountered an unknown error while requesting data via graphql`) — Dagger internal communication noise, does not mean the pipeline failed

Always look past these messages for the actual build/test/lint output to find real failures (e.g. `exit code: 1` from `withExec` steps).

## Debugging

### Interactive Breakpoints

```typescript
// Drop into shell at this point
container.terminal();

// Inspect a directory
dag.directory().withDirectory("/app", source).terminal();
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

## Container API Quick Reference

```typescript
dag
  .container()
  .from("image:tag") // Base image
  .withDirectory("/app", source) // Copy directory
  .withMountedDirectory("/app", source) // Mount (ephemeral)
  .withMountedCache("/cache", volume) // Persistent cache
  .withFile("/path", file) // Copy single file
  .withExec(["cmd", "args"]) // Run command
  .withEnvVariable("KEY", "value") // Set env var
  .withSecretVariable("KEY", secret) // Inject secret (safe)
  .withWorkdir("/app") // Set working dir
  .withEntrypoint(["cmd"]) // Set entrypoint
  .withLabel("key", "value") // OCI label
  .withExposedPort(8080) // Expose port
  .asService() // Convert to service
  .publish("registry/image:tag") // Push to registry
  .file("/path") // Extract file
  .directory("/path") // Extract directory
  .stdout() // Get stdout
  .stderr() // Get stderr
  .sync() // Force execution
  .terminal() // Interactive debug
  .combinedOutput() // Get interleaved stdout+stderr (0.19)
  .exportImage("name"); // Export to local container runtime (0.19)
```

## Error Handling Best Practices

### `.stdout()` vs `.sync()`

- **Use `.stdout()` as the terminal call** — triggers execution AND returns the output string, useful for debugging
- **Use `.sync()` only for pass/fail side effects** — returns the Container object, discards stdout/stderr
- `.stdout()` is always safe and gives better debugging; prefer it over `.sync()`

### `ExecError` Handling

Catch `ExecError` explicitly — it has `.cmd`, `.exitCode`, `.stdout`, `.stderr` properties:

```typescript
import { ExecError } from "@dagger.io/dagger";

try {
  await container.withExec(["bun", "run", "lint"]).stdout();
} catch (e: unknown) {
  if (e instanceof ExecError) {
    console.error(`Command: ${e.cmd}`);
    console.error(`Exit code: ${e.exitCode}`);
    console.error(`Stderr: ${e.stderr}`); // Access as property, not toString()
    console.error(`Stdout: ${e.stdout}`);
  }
  throw e;
}
```

**Since v0.15.0**, `ExecError.toString()` no longer includes stdout/stderr — you must access them as properties directly.

### Error Rules

- **Never truncate error messages** — full stderr is essential for debugging (no `.slice()`, no character limits)
- **`Promise.allSettled`**: check results and throw on failures. Do not swallow errors with `.catch()` into strings.

```typescript
// WRONG: swallows errors, CI always exits 0
const results = await Promise.allSettled(
  tasks.map((t) =>
    t.sync().catch((e: Error) => `FAIL: ${e.message.slice(0, 80)}`),
  ),
);

// RIGHT: failures propagate
const results = await Promise.allSettled(tasks.map((t) => t.stdout()));
const failures = results.filter(
  (r): r is PromiseRejectedResult => r.status === "rejected",
);
if (failures.length > 0) {
  throw new Error(failures.map((f) => f.reason).join("\n"));
}
```

## Caching Patterns

### Layer Ordering: Deps Before Source

Copy dependency files and install BEFORE mounting source code. Otherwise, any source change invalidates the install layer:

```typescript
const SOURCE_EXCLUDES = [
  "node_modules",
  ".eslintcache",
  "dist",
  "target",
  ".git",
  ".vscode",
  ".idea",
  "coverage",
  "build",
  ".next",
  ".tsbuildinfo",
  "__pycache__",
  ".DS_Store",
  "archive",
];

function bunBase(source: Directory, pkg: string): Container {
  return (
    dag
      .container()
      .from(BUN_IMAGE)
      .withMountedCache(
        "/root/.bun/install/cache",
        dag.cacheVolume("bun-cache"),
      )
      .withWorkdir("/workspace")
      // 1. Deps layer (cached unless lockfile changes)
      .withFile("/workspace/package.json", source.file("package.json"))
      .withFile("/workspace/bun.lock", source.file("bun.lock"))
      .withExec(["bun", "install", "--frozen-lockfile"])
      // 2. Source layer (only invalidated by actual source changes)
      .withDirectory("/workspace", source, { exclude: SOURCE_EXCLUDES })
      .withWorkdir(`/workspace/packages/${pkg}`)
  );
}
```

### `SOURCE_EXCLUDES` Constant

Use a shared `SOURCE_EXCLUDES` constant for ALL `withDirectory` calls. Include: `node_modules`, `.eslintcache`, `dist`, `target`, `.git`, `.vscode`, `.idea`, `coverage`, `build`, `.next`, `.tsbuildinfo`, `__pycache__`, `.DS_Store`, `archive`.

Missing `.git` in excludes is a common mistake — `.git` changes every commit and invalidates everything.

### Function Caching (v0.19.4+)

Default TTL is 7 days. Module source changes invalidate ALL function caches.

```typescript
@func()                           // default: cached 7 days
@func({ cache: "never" })         // always runs (deploy, publish, sync)
@func({ cache: "session" })       // cached per session only
@func({ cache: "10m" })           // cached for 10 minutes
```

Recommendations:

- `lint`, `typecheck`, `test`, `buildImage`: default (7-day) — inputs determine cache key
- `pushImage`, `deploySite`, `argoCdSync`, `tofuApply`, `helmPackage`: `cache: "never"` — side effects must always execute
- `ciAll` (orchestration): `cache: "session"` — run once per session

### Cache Volume Names

Cache volume names must be **stable** — never encode versions in the name. Version-keyed names (e.g., `bun-cache-1.2.3`) cause a cold cache on every version bump.

## CI Environment Variables

```bash
export DAGGER_PROGRESS=plain    # no TUI in CI
export DAGGER_NO_NAG=1          # suppress upgrade nags
export DAGGER_NO_UPDATE_CHECK=1 # suppress update checks
# Optional: DAGGER_LOG_STDERR=/tmp/dagger.log  # tee logs for artifact upload
```

## Debugging Workflow

| Tool                    | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `dagger call -i <func>` | Interactive mode — drops into shell on failure |
| `.terminal()`           | Insert explicit breakpoint mid-pipeline        |
| `--debug`               | Max verbosity — all internal engine spans      |
| `-v` / `-vv` / `-vvv`   | Increasing verbosity tiers                     |
| `--progress=plain`      | No TUI — suitable for CI logs                  |

## Anti-Patterns

1. **Floating image tags** (`oven/bun:debian`, `swiftlint:latest`) — non-reproducible. Pin with specific version and Renovate comments for auto-update.
2. **Source before deps in layer ordering** — defeats caching. Install runs on every source change. Always copy lockfile and install BEFORE mounting source.
3. **Error swallowing with `.catch()` to string** — CI exits 0 on failure. Let errors propagate or explicitly check `Promise.allSettled` results.
4. **Version-keyed cache volume names** — cold cache on every version bump. Use stable names like `"bun-cache"`, not `"bun-cache-1.2.3"`.
5. **Missing `.git` in excludes** — `.git` changes every commit, invalidates all downstream layers.
6. **`curl | bash` without version pinning** — gets latest, breaks reproducibility. Always pin the version in the URL or use a versioned installer.
7. **Side-effectful `WithExec` without forcing** — if no downstream consumer forces evaluation, the operation silently doesn't execute. Always call `.sync()` or `.stdout()` on containers with side effects.

## Module Organization

- **`@object()` class MUST stay in `index.ts`** — TypeScript SDK constraint. The decorated class cannot be split across files.
- **CAN import helper functions from other files** — keep `index.ts` thin with `@func()` wrappers that delegate to helpers.

```
.dagger/src/
  index.ts       # @object() class with all @func() methods (thin wrappers)
  ci.ts          # bunBase(), ciAll() implementation
  release.ts     # helm, tofu, npm, site deploy helpers
  quality.ts     # prettier, shellcheck, compliance helpers
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

## Reference Files

- **`references/release-notes.md`** - Features from Dagger 0.15, 0.16, 0.19, and 0.20: container import/export, Changeset API, Build-an-Agent, engine config, metrics, function caching, TypeScript SDK improvements
- **`references/monorepo-performance.md`** - Pre-call filtering, `ignore` annotations, `defaultPath` patterns, shared config without `--source .`, multi-module architecture, cache debugging commands, remote/registry cache, Dagger Shell and Checks, version performance history, case studies, pain points at scale, JS runtime comparison (pnpm/Deno), optimal caching strategy
- **`references/bun-container-caveats.md`** - Bun hardlink behavior across filesystem boundaries with CacheVolumes, `.d.ts` file skip bug (#27095), install backend options (`BUN_INSTALL_LINKS`), `bun.lock` vs `bun.lockb`, SDK runtime vs container runtime, workspace hoisting vs isolated mode caching implications
- **`references/deep-internals.md`** - Lazy evaluation and DAG model, Sync() semantics, silent non-execution pitfall, container reuse and content-addressed IDs (xxh3), branching vs chaining for parallelism, cache key computation details (mtime ignored, cascade effect), function/module patterns (polyglot, toolchains, constructor, tests sub-module), module publishing

## When to Ask for Help

Ask the user for clarification when:

- The target container registry isn't specified (ghcr.io, Docker Hub, etc.)
- Secret sources are ambiguous (env var, file, 1Password, Vault)
- Multiple pipeline stages could be organized differently
- Caching strategy needs customization for specific tools
- Integration with external services (databases, APIs) is needed
- Multi-architecture build requirements are unclear
