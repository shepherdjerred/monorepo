# Dagger Release Notes (0.15, 0.16, 0.19)

## Dagger 0.15 (Dec 2024)

### Better Errors
Errors appear at top of output in real-time, scrubbed of noise, with differentiation between warnings and critical failures.

### Faster Filesync
Centralized caching with reduced redundant transfers and lower memory usage.

### Metrics in TUI
CPU, disk, memory, and network metrics shown per-operation in real-time.

### Improved TUI
Cached vs pending indicators, accurate duration metrics, fewer unnecessary spans.

### Simpler Networking
`AsService` now respects image CMD/ENTRYPOINT defaults — no more empty `WithExec` hacks needed:
```typescript
// Before 0.15 - needed empty WithExec workaround
const svc = dag.container().from("redis:7").withExposedPort(6379).withExec([]).asService();

// 0.15+ - just works
const svc = dag.container().from("redis:7").withExposedPort(6379).asService();
```

### TypeScript SDK Improvements
- **`enum` keyword** — enums are registered when used by a module function:
  ```typescript
  export enum Status { Active = "Active", Inactive = "Inactive" }
  ```
- **`type` keyword** — lightweight type objects (no `@object()` decorator needed):
  ```typescript
  export type Message = { content: string; timestamp: number }
  ```
- **Custom base images** — set `dagger.baseImage` in `package.json` instead of default Node.js LTS Alpine:
  ```json
  {
    "dagger": {
      "baseImage": "node:20-slim"
    }
  }
  ```

### `dagger uninstall`
Cleanly remove module dependencies:
```bash
dagger uninstall <module>
```

### Cache Volumes in Debug Terminal
Debug sessions (`-i` flag) now mirror actual runtime mounts, so cache volumes are available during debugging.

## Dagger 0.16 (Feb 2025)

### 1Password & HashiCorp Vault Secrets
Fetch secrets directly in pipelines (see Secrets Management in SKILL.md):
```bash
dagger call deploy --token=op://vault/item/field
dagger call deploy --token=vault://path/to/secret
```

### Faster Module Loading
Up to 10x improvement in cache utilization for re-calls after source changes.

### `dagger update`
Update dependencies in `dagger.json`:
```bash
dagger update
```

### `engine.json` Configuration
New config file at `~/.config/dagger/engine.json` (replaces `engine.toml`):
```json
{
  "gc": {
    "keepBytes": 10000000000,
    "maxUsedSpace": 75
  },
  "log": {
    "level": "warn"
  }
}
```
Supports custom GC policies, log levels, and security settings. JSON schema documented in Dagger docs.

### Float64 Support
Floating-point numbers are now supported as a scalar type in the Dagger engine.

## Dagger 0.19 (Oct 2025)

### Container Runtime Support
No Docker required. Supported runtimes: **docker**, **podman**, **nerdctl**, **finch**, **Apple containers**.

Dagger auto-detects the available runtime, or set explicitly:
```bash
export DAGGER_RUNNER_HOST=podman-container://dagger-engine
```

### Import/Export Local Containers
Transfer images between Dagger and local container runtimes:

```typescript
// Export Dagger container to local runtime
await dag.container()
  .from("alpine:latest")
  .withExec(["apk", "add", "curl"])
  .exportImage("my-custom-alpine");

// Import from local runtime into Dagger
const local = dag.host().containerImage("my-local-image:latest");
```

CLI equivalents:
```bash
# Export
dagger call build --source=. exportImage --name=my-app

# Import
dagger call --image=container:my-local-image test
```

### Changeset API
New `Changeset` type for tracking generated file changes:
```typescript
@func()
async generate(source: Directory): Promise<Changeset> {
  const result = dag.container()
    .from("node:20")
    .withDirectory("/app", source)
    .withExec(["npx", "prisma", "generate"])
    .directory("/app");

  // Returns only the diff between original and modified
  return result.changes(source);
}
```
The CLI can apply changesets directly to the host filesystem, useful for code generation workflows.

### Build-an-Agent (LLM/AI APIs)
Dagger 0.19 introduces APIs for building AI agents that interact with modules:

```typescript
// Create an environment with workspace and tools
const env = dag.env()
  .withWorkspace(source)
  .withCurrentModule()         // Expose current module's functions as tools
  .withModule("github.com/org/helper-module");  // Add external module tools

// Configure LLM with MCP servers
const llm = dag.llm("openai/gpt-4")
  .withEnv(env)
  .withMCPServer(mcpServer);

// Run the agent
const result = await llm.run("Analyze this codebase and fix linting errors");
```

The TUI shows agent activity in a sidebar (toggle with `Ctrl+S`).

### New APIs
- **`combinedOutput()`** — get interleaved stdout+stderr from a container execution
- **`address` parsing** — structured access to container image address components
- **`Cloud.traceURL()`** — get the Dagger Cloud trace URL for the current run
- **GitRepository methods:**
  - `url` — get the repository URL
  - `branches` — list branches
  - `latestVersion` — get latest semver tag
  - `commonAncestor(ref1, ref2)` — find merge base between refs
