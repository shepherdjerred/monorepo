# Decision: Dagger `--source .` Cost vs Plain Step Isolation Loss

**Date:** 2026-04-03
**Status:** Analysis

## Problem

The CI pipeline has two competing failure modes:

1. **Dagger targets that take `--source .`** copy the entire monorepo (~hundreds of MB after excludes) into the Dagger engine. This is slow and amplifies disk I/O on the shared engine (see `decisions/2026-02-23_dagger-disk-write-amplification.md`).

2. **Steps that run outside Dagger** (`plainStep`) execute directly on the Buildkite agent pod. They avoid the copy cost but lose container isolation — they depend on whatever tools happen to be installed on the agent image, share the filesystem with other steps, and are not reproducible.

These are opposite ends of a tradeoff. Moving a step into Dagger improves reproducibility but increases engine load. Keeping it outside Dagger is fast but fragile.

## Current State

### Targets using `--source .` (full monorepo copy)

| Target                     | Why it needs the whole repo                                                           |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `tofu-plan` / `tofu-apply` | Tofu stacks reference modules across `packages/homelab/` and the root                 |
| `release-please`           | Reads/writes `package.json` files, changelogs, and git history across the entire repo |
| `code-review`              | Needs full source tree to review PR diffs in context                                  |
| `mkdocs-build`             | Reads `mkdocs.yml` at root + docs scattered across packages                           |
| `caddyfile-validate`       | Reads generated Caddyfile from `packages/homelab/` cdk8s output                       |
| `helm-package`             | Reads synthesized chart YAML from `packages/homelab/` + needs version metadata        |

By contrast, per-package targets (`lint`, `typecheck`, `test`) use `--pkg-dir ./packages/<name>` and only copy the specific package + its workspace deps. This is the correct pattern for isolated work.

### Steps running outside Dagger (plain shell on agent)

| Step                 | What it runs                                 | Why it's outside Dagger         |
| -------------------- | -------------------------------------------- | ------------------------------- |
| Prettier             | `bash .buildkite/scripts/prettier.sh`        | Fast, read-only check           |
| Shellcheck           | `install_shellcheck && find . -name "*.sh"`  | Downloads binary at runtime     |
| Quality Ratchet      | `bun scripts/quality-ratchet.ts`             | Reads metrics file              |
| Compliance Check     | `bash scripts/compliance-check.sh`           | Shell script                    |
| Knip                 | `bash .buildkite/scripts/knip-check.sh`      | Needs `node_modules` from agent |
| Gitleaks             | `install_gitleaks && gitleaks detect`        | Downloads binary at runtime     |
| Suppression Check    | `bun scripts/check-suppressions.ts`          | Reads source files              |
| Trivy Scan           | `bash .buildkite/scripts/trivy-scan.sh`      | Downloads binary at runtime     |
| Semgrep Scan         | `bash .buildkite/scripts/semgrep-scan.sh`    | Downloads binary at runtime     |
| Dagger Hygiene       | `bun scripts/check-dagger-hygiene.ts`        | Reads source files              |
| Lockfile Check       | `bun install --frozen-lockfile`              | Validates lockfile              |
| Env Var Names        | `bash scripts/check-env-var-names.sh`        | Shell grep                      |
| Migration Guard      | `bun scripts/guard-no-package-exclusions.ts` | Reads config                    |
| Merge Conflict Check | `grep -rl` for markers                       | Shell grep                      |
| Large File Check     | `find . -size +5M`                           | Shell find                      |
| Build Summary        | Assembles markdown annotation                | `buildkite-agent annotate`      |

**Common traits of plain steps:**

- Many download tools at runtime (`install_shellcheck`, `install_gitleaks`) — not hermetic
- Most need `bun` on the agent, coupling them to the agent image
- Several scan the full repo (`find .`, `grep -rl`, `gitleaks detect --source .`)
- None produce artifacts that downstream steps depend on — they're all leaf checks

## Analysis

### The real cost of `--source .`

When a Dagger function takes `--source .`, the CLI snapshots the working directory (minus `.daggerignore` patterns) and uploads it to the engine. For this monorepo:

- **Transfer cost**: every invocation re-hashes the tree. Even with content-addressed dedup, the directory scan itself takes seconds.
- **Engine I/O**: the snapshot becomes a BuildKit layer. Multiple concurrent `--source .` calls create multiple copies (see disk write amplification incident).
- **Cache invalidation**: any file change anywhere in the repo busts the cache for the entire `source` argument, so these targets rarely get cache hits.

### The real cost of running outside Dagger

- **Tool drift**: `install_shellcheck` downloads whatever version is current. The same commit can pass or fail depending on when it runs.
- **Agent coupling**: steps assume `bun`, `bash`, `find`, `grep` exist at specific versions. Agent image upgrades can break them silently.
- **No isolation**: a plain step that writes to `/tmp` or installs a global binary can affect subsequent steps on the same pod.
- **Not reproducible locally**: a developer can't run `dagger call shellcheck` — they have to replicate the agent environment.

### Where each approach is appropriate

**Use `--source .` when:**

- The target genuinely needs cross-package context (tofu, release-please, code-review)
- Reproducibility matters more than speed (deployments, releases)
- The target produces artifacts or side effects (helm-package, tofu-apply)

**Use `--pkg-dir` when:**

- Work is scoped to one package (lint, typecheck, test)
- The dependency tree is known and enumerable

**Use plain steps when:**

- The check is trivially fast (<5s) and read-only (merge conflict check, large file check)
- The step needs `buildkite-agent` CLI access (build summary annotations, artifact upload)
- The step is a gate that blocks nothing downstream

## Recommendations

### 1. Move security scanners into Dagger with pinned versions

Gitleaks, Trivy, Semgrep, and Shellcheck all download unpinned binaries at runtime. These should be Dagger functions with version-pinned container images:

```
dagger call gitleaks --source .
dagger call trivy-scan --source .
dagger call semgrep --source .
dagger call shellcheck --source .
```

Yes, these need `--source .`, but they're read-only scans that run once per build. The copy cost is acceptable for reproducibility. Consider using `dag.currentModule().source()` or a lighter directory filter if Dagger supports it.

### 2. Move Prettier and Knip into Dagger with `--pkg-dir` where possible

Prettier and Knip need `node_modules`. Running them outside Dagger couples them to the agent's `bun install` state. A Dagger function that installs deps in a container is more reliable.

### 3. Keep trivial checks as plain steps

Merge conflict check, large file check, env var names, lockfile check, dagger hygiene, and build summary are fine as plain steps. They use only basic shell tools, run in <5s, and gain nothing from containerization.

### 4. Reduce `--source .` blast radius where possible

Some targets that currently take the full repo could take narrower inputs:

- **`caddyfile-validate`**: only needs the generated Caddyfile, not the whole repo. Could take `--caddyfile-dir` instead.
- **`mkdocs-build`**: only needs `mkdocs.yml` + `docs/` directories. Could take specific directory args.
- **`helm-package`**: only needs the synthesized chart directory (output of `homelab-synth`). Already gets this as a dependency — could chain in Dagger rather than re-reading from host.

### 5. Accept `--source .` for cross-cutting targets

Tofu, release-please, and code-review genuinely need the full repo. Don't try to split them. The copy cost is the price of correctness.

## Decision Matrix

| Step               | Current             | Recommended                        | Rationale                                                 |
| ------------------ | ------------------- | ---------------------------------- | --------------------------------------------------------- |
| Gitleaks           | plain (unpinned)    | Dagger `--source .`                | Reproducibility > speed for security                      |
| Trivy              | plain (unpinned)    | Dagger `--source .`                | Same                                                      |
| Semgrep            | plain (unpinned)    | Dagger `--source .`                | Same                                                      |
| Shellcheck         | plain (unpinned)    | Dagger `--source .`                | Same                                                      |
| Prettier           | plain (needs bun)   | Dagger `--pkg-dir` or `--source .` | Hermetic deps                                             |
| Knip               | plain (needs bun)   | Dagger `--pkg-dir` or `--source .` | Hermetic deps                                             |
| Merge conflict     | plain               | plain                              | Trivial grep                                              |
| Large file         | plain               | plain                              | Trivial find                                              |
| Env var names      | plain               | plain                              | Trivial grep                                              |
| Lockfile check     | plain               | plain                              | `bun install --frozen-lockfile` is its own hermetic check |
| Dagger hygiene     | plain               | plain                              | Reads source, fast                                        |
| Migration guard    | plain               | plain                              | Reads config, fast                                        |
| Suppression check  | plain               | plain                              | Reads source, fast                                        |
| Build summary      | plain               | plain                              | Needs `buildkite-agent` CLI                               |
| Quality ratchet    | plain               | plain                              | Reads metrics, fast                                       |
| Compliance check   | plain               | plain                              | Shell script, fast                                        |
| Caddyfile validate | Dagger `--source .` | Dagger `--caddyfile-dir`           | Narrow input                                              |
| mkdocs-build       | Dagger `--source .` | Dagger with specific dirs          | Narrow input                                              |
| helm-package       | Dagger `--source .` | Dagger chain from synth output     | Avoid re-copy                                             |
| tofu-plan/apply    | Dagger `--source .` | Keep `--source .`                  | Genuinely cross-cutting                                   |
| release-please     | Dagger `--source .` | Keep `--source .`                  | Genuinely cross-cutting                                   |
| code-review        | Dagger `--source .` | Keep `--source .`                  | Genuinely cross-cutting                                   |
