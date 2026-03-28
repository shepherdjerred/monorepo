# Dagger Deep Internals

## Lazy Evaluation & DAG Model

Dagger's API is built on GraphQL with lazy evaluation. Pipeline definitions are sent from the SDK to the engine as GraphQL queries — SDKs don't run pipelines themselves, they build query graphs that the engine resolves.

### Lazy vs Forcing Operations

| Category               | Operations                                                    | Executes? |
| ---------------------- | ------------------------------------------------------------- | --------- |
| Lazy (build DAG)       | `From()`, `Build()`, all `With*()` methods                    | No        |
| Forcing (trigger work) | `ExitCode()`, `Stdout()`, `Publish()`, `Sync()`, `Contents()` | Yes       |

Rule of thumb: in TypeScript, `async` functions needing `await` trigger execution. In Go, functions taking `context.Context` and returning `error` trigger execution.

### Sync() Semantics

`Sync()` forces resolution without requiring a leaf value like `ExitCode()` or `Stdout()`. Use when wanting to force a build but not needing to read output. The result is the object itself, allowing continued chaining.

Key caveat: `Sync()` doesn't assume container execution is desired. If a container has no `WithExec()`, `Sync()` won't run the entrypoint — add `WithExec(nil)` explicitly for that.

### Silent Non-Execution

Without `Sync()` or another forcing function, side-effectful operations may silently not execute. If a Dagger object is created but never accessed — either by returning it to the CLI, reading data from it, or using it in another Function — Dagger automatically skips it as an optimization. This was a major source of user confusion (issue #4668).

Example: a `WithExec` that posts to an external API will NOT execute if no downstream consumer forces evaluation.

### Deferred Error Handling

Because evaluation is lazy, errors are deferred until a forcing function is called. If a `WithExec()` would fail, the error won't surface until calling `Stdout()`, `ExitCode()`, `Sync()`, or another forcing function.

Error handling patterns:

```typescript
// TypeScript: catch ExecError
try {
  await container.withExec(["bun", "test"]).sync();
} catch (e) {
  if (e instanceof ExecError) {
    console.error(`Stderr: ${e.stderr}`); // access as property
    console.error(`Exit code: ${e.exitCode}`);
  }
}

// Use ReturnType.Any to allow non-zero exit without throwing
const result = await container
  .withExec(["bun", "test"], { experimentalReturnType: "Any" })
  .sync();
```

## Container Reuse & Content-Addressed IDs

### How IDs Work

Every Dagger object (Container, Directory, File) has a content-addressed `call.ID` computed as:

```
xxh3(protobuf(ID{receiver, field, args}))
```

This ID encodes the entire chain of ancestor calls plus the current field name and arguments. It serves simultaneously as the cache key and the state identifier. Container and Directory objects are collections of immutable state updated by subsequent field resolutions — each `With*` method returns a new Container wrapping updated state, not mutating the original.

### WithExec Chaining Is Free

`WithExec()` does not immediately execute — it builds execution metadata (env, mounts, command), creates a content-addressed `call.ID`, and returns a new Container. Actual execution is deferred until a scalar output is requested.

Because of lazy evaluation, chaining multiple `WithExec` calls is essentially free in terms of engine round-trips — they accumulate as graph nodes without triggering execution. Only requesting a leaf value forces resolution.

### Branching vs Chaining

- **Branching** (assigning container to a variable, calling different `WithExec` chains on it): creates parallel DAG paths that BuildKit executes concurrently. Use for independent operations (lint and test from the same base).
- **Chaining** (sequential `WithExec` calls): creates a linear dependency chain. Use when steps must run in order (install deps then build).

```typescript
// Branching: parallel execution
const base = dag
  .container()
  .from("oven/bun:1")
  .withDirectory("/src", source)
  .withExec(["bun", "install"]);

await Promise.all([
  base.withExec(["bun", "run", "lint"]).sync(), // parallel branch 1
  base.withExec(["bun", "test"]).sync(), // parallel branch 2
  base.withExec(["bun", "run", "typecheck"]).sync(), // parallel branch 3
]);
```

Known issue: when chaining module functions from the CLI (not in-code), DAG concurrency can be lost — functions execute sequentially (issue #7353).

### Container Creation Cost

Creating a new container via `From("image")` incurs the cost of pulling/resolving the base image (cached by BuildKit after first pull). Chaining `WithExec` on an existing container reuses the filesystem snapshot — cheaper than starting fresh. Store the base container in a variable and branch from it.

## Cache Key Computation

### File Operations

For `WithDirectory` and `WithFile`, BuildKit calculates a cache checksum from file contents and metadata (filename, permissions, ownership). The checksum is computed by first hashing file metadata headers, then the file contents.

**mtime is NOT included** in the cache checksum. Touching a file to update its timestamp without changing content will NOT invalidate the layer cache.

`WithFile` is more granular than `WithDirectory` — only changes to that specific file invalidate the layer. `WithDirectory` invalidates if any file within the directory changes. Use `WithFile` for lockfiles, `WithDirectory` (with `include`/`exclude` filters) for source code.

### Exec Operations

For `WithExec`, the cache key is the command string plus all preceding layers. If all preceding layers are cache hits and the command string is identical, the layer is reused.

### The Cascade Effect

Once a layer is invalidated, ALL subsequent layers in the chain are also invalidated — the first changed instruction invalidates itself and everything that follows. This is why operation ordering matters enormously:

1. System packages (rarely change) — first
2. Dependency lockfile copy + install — second
3. Source code copy — last (changes most frequently)

### Function-Level Cache

Function cache keys include: module source code, function argument values, and parent object values. Default TTL is 7 days (since v0.19.4+). Configurable via `@func({ cache: "never" | "session" | "10m" })`.

Changing ANY file in the module's source directory invalidates ALL function cache for every function in that module. This means even fixing a typo in a comment in your `.dagger/src/` directory busts cache for all functions.

## Dagger Functions & Modules

### Polyglot Interoperability

Dagger Functions are polyglot-interoperable: a Python function can call a Go function, which can call a TypeScript function. Different teams can use different languages and their modules remain compatible — dependencies are naturally scoped since functions run in containers.

### Toolchains (v0.20)

Toolchains allow installing modules as composable extensions (`dagger toolchain install`) whose functions appear as namespaced fields in a module's API, without writing glue code. A monorepo could define a `bun` toolchain consumed by all sub-modules.

### Module Patterns

**Constructor pattern**: Accept configuration (base image, language version) in the module's constructor and store it on the struct. All module functions use this shared configuration:

```typescript
@object()
class MyModule {
  private baseImage: string;

  constructor(baseImage: string = "oven/bun:1.2") {
    this.baseImage = baseImage;
  }

  @func()
  build(source: Directory): Container {
    return dag
      .container()
      .from(this.baseImage)
      .withDirectory("/src", source)
      .withExec(["bun", "run", "build"]);
  }
}
```

**Base container pattern**: Write a function returning a configured Container, use it as a building block for other functions. Accept a `Container` argument with `defaultAddress` annotation so callers can override the base image while providing a sensible default.

**Tests sub-module pattern**: Create a `tests/` sub-module that `dagger install ..` the parent module, then calls parent functions to verify behavior. An `all()` function runs all tests in parallel using `Promise.all`.

### Module Publishing

Modules are versioned via Git tags using semver. For monorepo modules, prefix the tag with the subpath: `foo/v1.2.3` referenced as `GITSERVER/USER/REPO/foo@v1.2.3`. Private modules work via HTTPS (Git credential managers) or SSH (`SSH_AUTH_SOCK`).

The Daggerverse (daggerverse.dev) indexes ~1,500 public modules. Dagger Cloud adds a private Module Catalog with organization-scoped management and supply-chain visibility.
