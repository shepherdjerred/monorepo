# Bazel Version Guide for Rule Authors

Key changes across Bazel 7 through 10 that affect custom rule development, with migration checklists.

---

## Bazel 7 LTS (December 2023)

- **Bzlmod enabled by default** — `MODULE.bazel` with `bazel_dep()` replaces `WORKSPACE` + `http_archive`
- **Lockfile** — `MODULE.bazel.lock` records resolved dependency graph; commit this file
- **`bazel mod` command** — Inspect external dependency graph (modules, repos, extensions)
- **`use_repo_rule` directive** — Declare repo rules directly in MODULE.bazel
- **Platform-based toolchain resolution** — Default for Android and C++ rules
- **Skymeld** — Merged analysis + execution phases (default)
- **Build without the Bytes** — Only downloads top-level outputs (default)
- **BLAKE3 hash function** — `--digest_function=blake3`, faster than SHA-256
- **Experimental subrules** — Behind `--experimental_rule_extension_api`; `subrule()` primitive encapsulates reusable rule logic
- **Label stringification** — Labels now prefixed with `@@` (canonical repo names)

---

## Bazel 8 LTS (December 2024)

### Symbolic Macros (Major)

New macro system that addresses legacy macro shortcomings:

- **Typed arguments** — Like rule attributes, with type enforcement
- **Author-controlled `select()` permissions** — Per attribute
- **Macro-aware visibility** — Protects internal targets from external use
- **Rule Finalizers** — Macros that can call `native.existing_rules()` with less surprising behavior
- **Attribute schema inheritance** — From wrapped rules/macros
- **Future lazy evaluation** — Design enables skipping macros whose targets aren't requested

### Starlarkification (Major)

Built-in rules extracted to external repositories:

| Rule Set              | New Home      | Status in Bazel 8                        |
| --------------------- | ------------- | ---------------------------------------- |
| `android_*`           | rules_android | Fully extracted                          |
| C++ toolchain symbols | rules_cc      | Toolchain symbols only; rules in Bazel 9 |
| `java_*`              | rules_java    | Fully extracted                          |
| `*_proto_library`     | protobuf      | Fully extracted                          |
| `py_*` + PyInfo       | rules_python  | Fully extracted                          |
| `sh_*`                | rules_shell   | Fully extracted                          |

`--incompatible_autoload_externally` provides a grace period — automatically loads rules from new locations.

### Other Changes

- **WORKSPACE disabled by default** — `--enable_workspace=false` (can re-enable with `--enable_workspace=true`)
- **Compact execution log** — Significantly reduces log size and runtime overhead for cache-miss debugging
- **`compatibility_level` and `max_compatibility_level` are no-ops** — Provide build-time error messages instead

---

## Bazel 9 LTS (January 2026)

- **WORKSPACE completely removed** — All WORKSPACE code deleted from Bazel
- **C++ rule extraction completed** — All built-in C++ rules moved to rules_cc
- **`--incompatible_autoload_externally` empty by default** — Explicit `load()` statements required for all external rules; flag removed in Bazel 10
- **Repo contents cache** — `--repo_contents_cache` stores fetched repos shareable across workspaces
- **Experimental remote repo contents cache** — `--experimental_remote_repo_contents_cache` for CI
- **PROJECT.scl** — Experimental (`--experimental_enable_scl_dialect`): define canonical build flags per project directory
- **Starlark type annotations** — PEP 484-inspired syntax, experimental behind `--experimental_starlark_types`
- **Prebuilt protobuf** — Minimum protobuf 33.4 with prebuilt protoc support

---

## Bazel 10 (Planned, ~Late 2026)

- **Starlark type checking** — Static validation of type annotations (not just parsing)
- **`--incompatible_autoload_externally` removed** — No more migration bridge for built-in rule names

---

## Rule Author Migration Checklist

### Bazel 7 → 8

- [ ] Add `MODULE.bazel` if not present; migrate `http_archive` deps to `bazel_dep()`
- [ ] Add explicit `load()` statements for all rules from external repos (android, java, python, shell, proto)
- [ ] Test with `--enable_workspace=false` to verify MODULE.bazel completeness
- [ ] Consider converting legacy macros to symbolic macros for new code
- [ ] Update any code referencing `native.existing_rules()` — use rule finalizers instead

### Bazel 8 → 9

- [ ] Remove all WORKSPACE and WORKSPACE.bzlmod files
- [ ] Convert all remaining WORKSPACE repo rules to module extensions
- [ ] Add explicit `load()` for C++ rules from rules_cc
- [ ] Verify `--incompatible_autoload_externally` is not relied upon (empty by default)
- [ ] Test with minimum protobuf 33.4 if using proto rules
- [ ] Consider using `--repo_contents_cache` for faster CI cold starts

### Bazel 9 → 10

- [ ] Ensure no reliance on `--incompatible_autoload_externally` (will be removed)
- [ ] Experiment with Starlark type annotations for `.bzl` files
- [ ] Watch for type checking enforcement and prepare annotations

### General Best Practices

- Pin Bazel version in `.bazelversion` file
- Use `bazel_dep()` with version constraints in MODULE.bazel
- Test against multiple Bazel versions in CI using `rules_bazel_integration_test`
- Follow Bazel blog for breaking change announcements
- Check `--incompatible_*` flags before upgrading: `bazel build --check_bzl_visibility=true //...`
