# Module Extensions and Repository Rules

Guide to writing Bzlmod module extensions and repository rules for custom Bazel rulesets. Covers tag classes, hub repos, toolchain registration, and testing.

---

## Module Extension Anatomy

Module extensions replace the old WORKSPACE pattern. Two parts: **tag classes** (user-facing schema) and an **implementation function** (processes tags, calls repository rules).

```python
_download_tag = tag_class(attrs = {
    "version": attr.string(mandatory = True),
})

def _my_ext_impl(ctx):
    # Iterate all modules in the dependency graph
    for module in ctx.modules:
        for tag in module.tags.download:
            version = tag.version
            # Version resolution logic...

    # Call repository rules to materialize downloads
    my_download(name = "my_sdk_linux_amd64", urls = [...], sha256 = "...")

    # Create a hub repo for toolchain registration
    my_toolchains(name = "my_toolchains", repos = repo_names)

my_ext = module_extension(
    implementation = _my_ext_impl,
    tag_classes = {"download": _download_tag},
    os_dependent = True,
    arch_dependent = True,
)
```

User-facing MODULE.bazel:

```python
my_ext = use_extension("@my_rules//:extensions.bzl", "my_ext")
my_ext.download(version = "1.5.0")
use_repo(my_ext, "my_toolchains")
register_toolchains("@my_toolchains//:all")
```

### Key Extension Features

- **`os_dependent`/`arch_dependent`** — Control lockfile behavior; set `True` when fetching platform-specific artifacts
- **`ctx.extension_metadata(reproducible=True/False)`** — Enable lockfile integration for reproducible builds
- **Version conflict resolution** — Extensions can resolve version conflicts across the dependency graph (impossible with WORKSPACE repo rules)
- **`ctx.modules`** — Iterate all modules that use this extension, accessing their tags

---

## Repository Rules

Repository rules define external repositories — directory trees generated on demand. They run during the loading/fetching phase and can perform I/O.

```python
def _my_download_impl(ctx):
    ctx.download_and_extract(
        url = ctx.attr.urls,
        sha256 = ctx.attr.sha256,
        stripPrefix = ctx.attr.strip_prefix,
    )
    ctx.template(
        "BUILD.bazel",
        ctx.attr._build_tpl,
        substitutions = {
            "{name}": ctx.attr.name,
            "{exec_constraints}": _platform_constraints(ctx.attr.os, ctx.attr.arch),
        },
    )

my_download = repository_rule(
    implementation = _my_download_impl,
    attrs = {
        "urls": attr.string_list(mandatory = True),
        "sha256": attr.string(mandatory = True),
        "strip_prefix": attr.string(default = ""),
        "os": attr.string(mandatory = True),
        "arch": attr.string(mandatory = True),
        "_build_tpl": attr.label(default = "//internal:BUILD.bazel.tpl"),
    },
)
```

### Key Patterns

- Use `ctx.download_and_extract()` for archives, `ctx.download()` for single files
- Generate `BUILD.bazel` files via `ctx.template()` or `ctx.file()`
- Always use `sha256` attributes for reproducibility
- Re-fetch triggers: attribute changes, implementation code changes, watched file changes, `bazel fetch --force`
- Isolate toolchain downloads in separate `.bzl` files to prevent cascading re-fetches
- Avoid `uname` / `/proc` inspection — rely on platform constraints instead

---

## Hub Repo Pattern

Create a hub repository that declares `toolchain()` targets for all platforms, so users only need a single `register_toolchains` call:

```python
def _my_toolchains_impl(ctx):
    content = ""
    for repo in ctx.attr.repos:
        content += """
toolchain(
    name = "{repo}_toolchain",
    toolchain = "@{repo}//:toolchain_impl",
    toolchain_type = "@my_rules//:toolchain_type",
    exec_compatible_with = ["@platforms//os:{os}", "@platforms//cpu:{cpu}"],
    target_compatible_with = ["@platforms//os:{os}", "@platforms//cpu:{cpu}"],
)
""".format(repo = repo, os = _get_os(repo), cpu = _get_cpu(repo))

    ctx.file("BUILD.bazel", content)

my_toolchains = repository_rule(
    implementation = _my_toolchains_impl,
    attrs = {"repos": attr.string_list()},
)
```

User just needs: `register_toolchains("@my_toolchains//:all")`

---

## Testing Module Extensions

Module extensions and repository rules cannot be tested with analysis tests (they run in loading/fetching phase, not analysis). Use integration testing:

### With `rules_bazel_integration_test`

1. Create a child workspace that uses the extension
2. Invoke Bazel in that workspace
3. Verify the result

### Manual Child Workspace

```python
# child_workspace/MODULE.bazel
bazel_dep(name = "my_rules", version = "0.0.0")
local_path_override(module_name = "my_rules", path = "../..")
```

Use `bazel mod deps` to unconditionally evaluate all module extensions (useful for testing evaluation logic).

---

## WORKSPACE to Bzlmod Migration

| WORKSPACE                     | Bzlmod Equivalent          |
| ----------------------------- | -------------------------- |
| `workspace()`                 | `module()` in MODULE.bazel |
| `http_archive` deps           | `bazel_dep()` directives   |
| `bind()`                      | `alias()` build rules      |
| `local_repository`            | `local_path_override()`    |
| Transitive dep macros         | Automatic MVS resolution   |
| Repository rules in WORKSPACE | Module extensions          |

### Timeline

| Version | Status                                                     |
| ------- | ---------------------------------------------------------- |
| Bazel 7 | Bzlmod on by default; WORKSPACE still works                |
| Bazel 8 | WORKSPACE disabled by default (`--enable_workspace=false`) |
| Bazel 9 | WORKSPACE code completely removed                          |
