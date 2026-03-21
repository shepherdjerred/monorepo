# Starlark Rule Design Patterns

Deep-dive on provider design, toolchains, actions, macros, aspects, and advanced patterns for writing custom Bazel rules.

---

## Provider Design

### Public/Private Separation

Structure `ToolchainInfo` (or custom providers) with a clear public API and private internals:

```python
return [platform_common.ToolchainInfo(
    # Public API — rules call these functions
    compile = go_compile,
    link = go_link,
    build_test = go_build_test,
    # Private internals — actions use these, rules should not
    internal = struct(
        go_cmd = go_cmd,
        env = env,
        builder = ctx.executable.builder,
        tools = ctx.files.tools,
    ),
)]
```

Document the `ToolchainInfo` contract since Starlark has no interfaces.

### Depset Best Practices

```python
# CORRECT: Merge all transitive depsets at once
return [MyInfo(
    deps = depset(
        direct = [my_info],
        transitive = [d[MyInfo].deps for d in ctx.attr.deps],
    ),
)]

# WRONG: Build depsets in a loop (creates deeply nested structures)
result = depset()
for dep in ctx.attr.deps:
    result = depset(transitive = [result, dep[MyInfo].deps])
```

- Use `providers = [MyInfo]` on `attr.label_list` to enforce deps return the right provider
- Put small, immutable data in `direct` elements (gets hashed)
- Never call `to_list()` in library rules — only in terminal rules (binaries)

---

## Toolchain Pattern (Full Walkthrough)

### Step 1 — Declare a Toolchain Type

```python
# In your ruleset's BUILD file
toolchain_type(name = "toolchain_type", visibility = ["//visibility:public"])
```

### Step 2 — Create a Toolchain Implementation Rule

```python
def _my_toolchain_impl(ctx):
    compiler = ctx.executable.compiler
    return [platform_common.ToolchainInfo(
        compile = _compile_action,
        internal = struct(
            compiler = compiler,
            stdlib = ctx.file.stdlib,
        ),
    )]

my_toolchain = rule(
    implementation = _my_toolchain_impl,
    attrs = {
        "compiler": attr.label(mandatory = True, executable = True, cfg = "exec"),
        "stdlib": attr.label(mandatory = True, allow_single_file = True, cfg = "target"),
    },
)
```

### Step 3 — Register via `toolchain()` with Platform Constraints

```python
toolchain(
    name = "my_toolchain_linux_x86",
    exec_compatible_with = ["@platforms//os:linux", "@platforms//cpu:x86_64"],
    target_compatible_with = ["@platforms//os:linux", "@platforms//cpu:x86_64"],
    toolchain = ":my_toolchain_impl",
    toolchain_type = "@my_rules//:toolchain_type",
)
```

Register in MODULE.bazel: `register_toolchains("@my_download//:toolchain")`

### Step 4 — Consume in Rules

```python
my_rule = rule(
    implementation = _my_rule_impl,
    toolchains = ["@my_rules//:toolchain_type"],
)

def _my_rule_impl(ctx):
    tc = ctx.toolchains["@my_rules//:toolchain_type"]
    tc.compile(ctx, srcs = ctx.files.srcs, out = output)
```

Use `--toolchain_resolution_debug` to troubleshoot selection issues.

---

## Builder Binary Pattern

Push complex logic to the execution phase via a builder binary written in a general-purpose language (Go, Rust, Python). This is the most important pattern for non-trivial rulesets.

**Why:**
- Starlark (loading/analysis) should remain simple — declare files, actions, and inputs
- Complex logic (parsing, code generation, file filtering) needs full I/O
- Builder runs during execution — benefits from remote execution and caching
- Can be written in any language with access to standard libraries

**How:**
- Write a single builder binary that handles multiple "verbs" (compile, link, test)
- Define a bootstrap rule (`go_tool_binary` / `rust_tool_binary`) to compile the builder itself
- All user-facing rules invoke the builder via `ctx.actions.run()`

```python
def _my_rule_impl(ctx):
    tc = ctx.toolchains["@my_rules//:toolchain_type"]
    ctx.actions.run(
        executable = tc.internal.builder,
        arguments = ["compile", "--src", ctx.file.src.path, "--out", output.path],
        inputs = [ctx.file.src] + tc.internal.tools,
        outputs = [output],
        mnemonic = "MyCompile",
    )
```

One binary is better than many — faster to build, and it changes infrequently.

---

## Hidden Attributes

Attributes whose names start with `_` are hidden — they must have a `default` value and cannot be set in BUILD files. Use them for implicit dependencies:

```python
attrs = {
    "srcs": attr.label_list(allow_files = [".my"], mandatory = True),
    "_stdlib": attr.label(
        default = "//internal:stdlib",
        allow_single_file = True,
    ),
    "_compiler": attr.label(
        default = "//tools:compiler",
        executable = True,
        cfg = "exec",
    ),
}
```

---

## Action Patterns

### `run()` vs `run_shell()`

```python
# PREFERRED: Direct execution — portable, no shell dependency
ctx.actions.run(
    executable = ctx.executable._tool,
    arguments = [args],
    inputs = inputs,
    outputs = [output],
    mnemonic = "Process",
)

# AVOID: Shell execution — needs Bash, quoting issues
ctx.actions.run_shell(
    command = "{tool} {src} > {out}".format(...),
    inputs = inputs,
    outputs = [output],
)
```

Use `run_shell()` only when shell features (pipes, redirects) are genuinely needed.

### `ctx.actions.args()` for Deferred Expansion

```python
args = ctx.actions.args()
args.add_all(sources)                    # accepts depsets without flattening
args.add("--output", output.path)
ctx.actions.run(
    executable = ctx.executable._compiler,
    arguments = [args],
    inputs = depset(srcs, transitive = [dep_inputs]),
    outputs = [output],
    mnemonic = "Compile",
)
```

This defers depset expansion to the execution phase, potentially reducing analysis-phase memory by 90%+.

---

## Macro Conventions

- Always accept a `name` argument and create a target with that name
- Prefix generated internal targets: `name = "%s_bar" % (name)`
- Use only keyword arguments when calling macros
- Do not create variables just to avoid BUILD file repetition — DRY does not apply to BUILD files

---

## Aspect Patterns

```python
my_aspect = aspect(
    implementation = _my_aspect_impl,
    attr_aspects = ["deps"],              # propagate along deps
    required_providers = [CcInfo],        # only apply to targets with CcInfo
    attrs = {
        "_tool": attr.label(default = "//tools:analyzer", cfg = "exec", executable = True),
    },
)
```

Aspects propagate via command line (`--aspects=file.bzl%my_aspect`) or attached to rule attributes (`attr.label_list(aspects = [my_aspect])`). Aspects return custom providers but never `DefaultInfo`.

---

## Exec Transitions and Custom Transitions

Use `cfg = "exec"` on attributes pointing to build tools:

```python
"_compiler": attr.label(default = "//tools:compiler", executable = True, cfg = "exec")
```

Custom transitions change build configuration for specific dependencies:

```python
def _transition_impl(settings, attr):
    return {"//my_project:feature_flag": "enabled"}

my_transition = transition(
    implementation = _transition_impl,
    inputs = [],
    outputs = ["//my_project:feature_flag"],
)
```

**Caution:** Transitions create configuration forks. A chain of n branching transitions produces 2^n configurations. Use sparingly.

When using outgoing transitions, `ctx.attr.dep` becomes a list (even for `attr.label`). Access via `ctx.attr.dep[0]` for 1:1 transitions.

---

## Subrules (Bazel 6+)

Extract reusable rule logic into modular units:

```python
my_subrule = subrule(implementation = _subrule_impl, attrs = { ... })

my_rule = rule(
    implementation = _rule_impl,
    subrules = [my_subrule],  # attributes "lifted" into the rule
)
```

Subrules are experimental (Bazel 7+) — behind `--experimental_rule_extension_api`.
