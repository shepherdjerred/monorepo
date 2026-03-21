---
name: bazel-rules
description: >
  Bazel Starlark rule development — writing custom rules, providers, toolchains,
  macros, aspects, actions, and testing.
  This skill should be used when the user asks to "write a custom Bazel rule",
  "create a provider", "define a toolchain", "write an analysis test",
  "create a module extension", "debug rule behavior", "write a macro",
  "create an aspect", or works with BUILD.bazel rule definitions and .bzl files.
  Also use when writing repository rules, writing a builder binary,
  fixing depset performance, migrating WORKSPACE to Bzlmod,
  debugging remote execution issues with custom rules,
  or reviewing Starlark code for correctness.
---

# Bazel Starlark Rule Authoring

Comprehensive guide for writing custom Bazel rules, providers, toolchains, macros, aspects, and tests in Starlark. Covers Bazel 7 through 10.

---

## Rules vs Macros vs Aspects

| Mechanism | Use When | Visibility | Phase |
|-----------|----------|------------|-------|
| **Rule** | Custom build actions, providers, or toolchain access needed | Full target in query/IDE | Analysis + Execution |
| **Macro** | Simple composition of existing rules; leaf-node convenience wrappers | Expanded before analysis; invisible to `bazel query` | Loading |
| **Symbolic Macro** (8+) | Typed, composable wrappers with controlled visibility | Macro-aware visibility; protected internal targets | Loading |
| **Aspect** | Cross-cutting concerns (linting, IDE support) across the entire graph | Propagates across deps | Analysis |

Prefer rules over macros whenever possible. Macros expand during loading and are invisible to `bazel query`, breaking IDE tooling and debugging. Safe macro uses: leaf nodes like test permutations.

Symbolic macros (Bazel 8+) address legacy macro shortcomings with typed arguments, author-controlled `select()` permissions, and macro-aware visibility.

---

## Rule Anatomy

Every rule has three parts: a `rule()` declaration, an implementation function, and attribute definitions.

```python
def _my_rule_impl(ctx):
    output = ctx.actions.declare_file(ctx.label.name + ".out")
    ctx.actions.run(
        executable = ctx.executable._tool,
        arguments = [ctx.file.src.path, output.path],
        inputs = [ctx.file.src],
        outputs = [output],
        mnemonic = "MyRule",
    )
    return [DefaultInfo(files = depset([output]))]

my_rule = rule(
    implementation = _my_rule_impl,
    attrs = {
        "src": attr.label(allow_single_file = True, mandatory = True),
        "_tool": attr.label(
            default = "//tools:my_tool",
            executable = True,
            cfg = "exec",
        ),
    },
)
```

Key elements:
- `_impl(ctx)` — Implementation function receives analysis context
- `attrs` — Typed attribute declarations (`attr.label`, `attr.string`, `attr.label_list`, etc.)
- `_` prefix on attrs — Hidden attributes with defaults (implicit dependencies)
- `cfg = "exec"` — Build tools for the execution platform (enables cross-compilation)
- Return a list of providers (`DefaultInfo`, custom providers, `OutputGroupInfo`)

---

## Provider Design

Structure providers with a clear public API and private internals:

```python
MyLibInfo = provider(
    doc = "Information about a compiled library",
    fields = {
        "info": "struct with archive and importpath",
        "deps": "depset of info structs for transitive dependencies",
    },
)

def _lib_impl(ctx):
    info = struct(archive = output, importpath = ctx.attr.importpath)
    return [
        DefaultInfo(files = depset([output])),
        MyLibInfo(
            info = info,
            deps = depset(
                direct = [d[MyLibInfo].info for d in ctx.attr.deps],
                transitive = [d[MyLibInfo].deps for d in ctx.attr.deps],
            ),
        ),
    ]
```

**Depset rules:**
- Pass depsets directly to `inputs` — never flatten to lists in library rules
- Call `to_list()` only in terminal rules (binaries), never in libraries (avoids O(n^2))
- Use `providers = [MyLibInfo]` on `attr.label_list` to enforce correct deps
- Build depsets in one merge, not in a loop

---

## Toolchain Pattern

Three-part dependency injection system:

1. **Declare type**: `toolchain_type(name = "toolchain_type")`
2. **Implementation rule**: Returns `ToolchainInfo` with public methods and private `internal` struct
3. **`toolchain()` target**: Connects implementation to platform constraints

Consume in rules via `ctx.toolchains["@my_rules//:toolchain_type"]`.

See `references/patterns.md` for the full 4-step walkthrough with code.

---

## Action Patterns

- **Prefer `ctx.actions.run()`** over `ctx.actions.run_shell()` — more portable, no Bash dependency, better for remote execution
- **Use `ctx.actions.args()`** for argument lists — defers depset expansion to execution phase, reducing analysis-phase memory
- **Declare all inputs and outputs explicitly** — undeclared files won't exist in the sandbox
- **Set meaningful `mnemonic`** values for clean `bazel build` output
- **Push complex logic to execution** via a builder binary — keep Starlark simple

---

## Key Anti-Patterns

| Anti-Pattern | Consequence | Fix |
|---|---|---|
| `depset.to_list()` in library rules | O(n^2) time/space across build graph | Only call `to_list()` in terminal rules |
| Building depsets in a loop | Deeply nested structures, poor performance | Collect all transitive depsets, merge once |
| Flattening depsets for action inputs | Defeats lazy evaluation, wastes memory | Pass `depset` directly to `inputs` |
| `run_shell` when `run` suffices | Non-portable, quoting bugs | Use `run()` with an executable tool |
| Complex logic in Starlark analysis | Can't read files, can't be cached/distributed | Write a builder binary, invoke via `run()` |
| Not declaring all action inputs | Breaks hermeticity, sandbox, caching | Explicitly list every input file |
| Macros for complex build logic | Invisible to query/aspects, hard to debug | Convert to a rule |
| Returning mutable/large objects in providers | Hashing overhead, memory waste | Use small immutable structs |

---

## Testing Quick Reference

| What to Test | Framework | Key Function |
|---|---|---|
| Pure utility functions | Skylib `unittest` | `unittest.make()`, `unittest.suite()` |
| Rule providers & actions | `rules_testing` or Skylib `analysistest` | `analysis_test()`, `analysistest.make()` |
| Rule failure behavior | Skylib `analysistest` | `analysistest.make(impl, expect_failure=True)` |
| Rule output correctness | `sh_test` / custom test rule | Script validates artifacts |
| Repo rules / module extensions | `rules_bazel_integration_test` | Child workspace + recursive Bazel |
| Documentation accuracy | Stardoc + `diff_test` | `stardoc_with_diff_test` |
| Macros | Analysis tests on produced targets | Test the targets the macro creates |

See `references/testing.md` for detailed examples and patterns.

---

## Bazel Version Notes for Rule Authors

| Feature | Version | Impact |
|---------|---------|--------|
| Symbolic macros | 8+ | Typed arguments, controlled visibility, rule finalizers |
| Starlarkification | 8/9 | Built-in rules extracted to external repos; add explicit `load()` statements |
| WORKSPACE removed | 9 | Must use MODULE.bazel + module extensions |
| C++ rules to rules_cc | 9 | Completed extraction |
| `--incompatible_autoload_externally` | 9 (empty), 10 (removed) | Explicit loads required |
| PROJECT.scl | 9 (experimental) | Project-based build flags |
| Starlark type annotations | 9 (experimental) | PEP 484-inspired syntax |
| Type checking | 10 (planned) | Static validation of annotations |

See `references/version-guide.md` for migration checklists.

---

## Reference Files

| File | Use When |
|------|----------|
| `references/patterns.md` | Writing providers, toolchains, actions, aspects, or builder binaries from scratch |
| `references/testing.md` | Setting up tests for custom rules — unit, analysis, integration, or documentation |
| `references/module-extensions.md` | Creating module extensions, repository rules, or migrating from WORKSPACE |
| `references/version-guide.md` | Upgrading Bazel versions or understanding compatibility requirements |
