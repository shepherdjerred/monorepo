# No-Sandbox npm Materialization

## Decision

Use `execution_requirements = {"no-sandbox": "1"}` on the `BunMaterialize` action and eliminate the `bun_npm_dir` TreeArtifact layer entirely.

Previously, ~1,060 `bun_npm_dir` actions wrapped npm package directories as TreeArtifacts in `@bun_modules`. These existed solely for sandbox compatibility. With `no-sandbox`, the materialize script reads npm directories directly from `external/bun_modules/...` in the exec root, making the intermediate layer unnecessary.

## Why

Profiling shows Bazel's sandbox overhead dominates actual work:

| Phase                                   | With sandbox    | Without sandbox (expected) |
| --------------------------------------- | --------------- | -------------------------- |
| Sandbox creation (symlinks for inputs)  | 11-20s per tree | 0s                         |
| Action execution (materialize script)   | 5-8s per tree   | 5-8s per tree              |
| Output scanning (stat all output files) | 10-17s per tree | reduced                    |
| Total per tree                          | 40-50s          | ~5-10s                     |

Removing the `bun_npm_dir` layer eliminates ~1,060 build actions entirely (each created a sandbox, ran `cp -Rc`, tore down the sandbox).

## What no-sandbox preserves

- **Input tracking and hashing** — Bazel still computes action cache keys from declared inputs. If `bun.lock` or source files change, the action re-runs.
- **Disk cache** — results are cached locally, surviving `bazel clean`.
- **Remote cache** — results can be uploaded/downloaded from the shared cache. CI populates, local dev reads.
- **Dependency graph** — Bazel still schedules actions correctly based on declared deps.
- **Incrementality** — unchanged inputs = cache hit = no re-execution.

## What no-sandbox skips

- **Filesystem isolation** — the action runs in the exec root, not a sandboxed directory. It _could_ read undeclared files. For npm package copying this is a non-risk.
- **Output copying** — sandbox normally copies outputs from the sandbox dir to bazel-out. Without sandbox, outputs are written directly to bazel-out.
- **Input/output stat verification** — sandbox verifies that the action only read declared inputs and only wrote declared outputs.

## Why this is safe for npm materialization

1. **npm packages are immutable** — determined entirely by `bun.lock` with integrity hashes. They don't change between builds.
2. **The lockfile is a declared Bazel input** — if dependencies change, the action re-runs.
3. **Actions are pure filesystem operations** — `cp`, `ln`, `mkdir`. No network access, no side effects beyond the output directory.
4. **No undeclared inputs** — the source is `@bun_modules` (an external repo populated by a repo rule), the destination is the output TreeArtifact. There's nothing else to read.

## Why no-sandbox is mandatory (not just a performance optimization)

With `bun_npm_dir` removed, `bun_npm_package` provides raw filegroup files (not TreeArtifacts). The `_format_npm_entry` function derives `src_dir` as `external/bun_modules/...` — an exec-root-relative path that is only accessible without sandbox. In a sandboxed build, individual files are symlinked in but the directory structure is not preserved as a traversable directory, so `fs.cpSync(src_dir, ...)` would fail.

## Industry precedent

[aspect-build/rules_js](https://github.com/aspect-build/rules_js) — the most widely-used Bazel rules for JavaScript — defaults to `no-sandbox` for npm lifecycle hooks and package operations:

> "defaults to `["no-sandbox"]` to limit the overhead of sandbox creation and copying the output TreeArtifact out of the sandbox"

Their npm package linking actions use `execution_requirements = {"no-sandbox": "1"}` while retaining full remote cache support. Results are shared across developers via remote cache.

See also [Bazel issue #5153](https://github.com/bazelbuild/bazel/issues/5153): Angular's builds went from 22 min to 80 min when including full `node_modules` (64K files) as sandboxed inputs. The solution was reducing input count and relaxing sandbox requirements for npm operations.

## Affected actions

| Action               | Mnemonic         | File                                          | Impact                                                       |
| -------------------- | ---------------- | --------------------------------------------- | ------------------------------------------------------------ |
| `materialize_tree()` | `BunMaterialize` | `tools/rules_bun/bun/private/materialize.bzl` | All prepared tree targets + inline materialization fallbacks |

## NOT affected

| Action                                                               | Why                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `bun_prisma_generate`                                                | Different action with `requires-network`; needs its own execution_requirements              |
| `bun_build` / `bun_build_test`                                       | Only consume `BunTreeInfo`, don't call `materialize_tree()`                                 |
| `bun_service_image`                                                  | Uses custom genrule, not `materialize_tree()`                                               |
| `bun_test`, `bun_eslint_test`, `bun_typecheck_test` (test execution) | The test execution itself remains sandboxed; only the materialization action is unsandboxed |

## CI compatibility

- CI uses **remote caching only** (not remote execution) — `no-sandbox` actions work identically
- CI runs in K8s pods with standard container security — no restrictions on unsandboxed local execution
- CI config (`--config=ci`) uses `--sandbox_fake_hostname` and `--sandbox_fake_username` which are orthogonal to `no-sandbox`
