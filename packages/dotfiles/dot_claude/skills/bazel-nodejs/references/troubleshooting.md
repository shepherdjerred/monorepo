# Troubleshooting Bazel + Node.js/npm

## Phantom Dependency Errors

**Symptom**: Runtime error like `Cannot find module 'foo'` where `foo` is a transitive dependency not declared in the failing package's `package.json`.

**Cause**: rules_js enforces strict dependency isolation (pnpm `hoist=false` mode). Packages can only resolve their declared dependencies, not undeclared transitive ones that happen to be hoisted in a flat `node_modules`.

**Fix**: Add the missing dependency via `pnpm.packageExtensions` in the root `package.json`:

```json
{
  "pnpm": {
    "packageExtensions": {
      "some-package": {
        "dependencies": {
          "missing-dep": "*"
        }
      }
    }
  }
}
```

Then regenerate the lockfile with `pnpm install --lockfile-only`.

## ESM Sandbox Escape (#362)

**Symptom**: ESM imports resolve paths outside the Bazel sandbox. Tests pass but with non-hermetic behavior.

**Cause**: Node.js's ESM resolver uses `realpathSync` directly, bypassing the fs patches that `js_binary` installs for CJS. Open issue since 2022.

**Workaround**: No clean fix. For affected packages, consider using CJS entry points where available, or accept reduced hermeticity for ESM-heavy targets.

## Cache Invalidation on New Package (#2540)

**Symptom**: Adding one npm package causes seemingly unrelated targets to rebuild.

**Cause**: The hub repository (`@npm`) regenerates when the lockfile changes, which can change the hash of generated `defs.bzl` files that many targets depend on.

**Mitigation**: Batch dependency additions/upgrades into fewer lockfile changes. Use `pnpm update` for batched upgrades rather than individual `pnpm add` commands.

## Lockfile Parsed for Unrelated Targets (#2769)

**Symptom**: Building a Rust or Go target still triggers pnpm lockfile parsing, adding seconds to the build.

**Cause**: The `npm_translate_lock` module extension runs during Bazel's loading phase for any target that transitively references the `@npm` repository, even indirectly.

**Mitigation**: This is an architectural limitation. Keep the lockfile small where possible. rules_js 3.x includes a "avoid double-parsing" optimization.

## Module Resolution Failures

**Symptom**: `Error: Cannot find module '@scope/package'` in a BUILD target that correctly lists `:node_modules/@scope/package` in deps.

**Debugging steps**:

1. Verify the package exists in `pnpm-lock.yaml`
2. Check the generated `defs.bzl`: `bazel query @npm//:defs.bzl --output=build`
3. Verify `npm_link_all_packages()` is called in the BUILD file next to the relevant `package.json`
4. For scoped packages, ensure the correct `:node_modules/@scope/package` label syntax

## Missing Package in BUILD

**Symptom**: `:node_modules/foo` target does not exist.

**Cause**: The package's `package.json` is not listed in `npm_translate_lock`'s scope, or `npm_link_all_packages()` is not called in the BUILD file.

**Fix**:

1. Ensure the workspace's `package.json` is in the `package_jsons` list (for Bzlmod: the `npm.npm_translate_lock()` tag in `MODULE.bazel`)
2. Add `npm_link_all_packages(name = "node_modules")` to the BUILD file
3. Run `bazel fetch @npm//...` to verify the package resolves

## Windows-Specific Issues

- **bsdtar.exe missing DLLs** (#1739): The vendored `bsdtar` on Windows may fail to extract tarballs
- **`js_test` chdir fails** (#2333): Working directory setup behaves differently on Windows
- **Lifecycle hooks incompatible** (#2339): Some lifecycle hooks fail in Windows sandbox

Windows support has multiple known gaps. Consider Linux/macOS CI for Bazel JS builds.

## `__dirname` Not Hermetic (#1669)

**Symptom**: `__dirname` in Node.js points to the Bazel output tree path, not the source tree.

**Cause**: By design -- rules_js copies sources to the output tree and runs there. `__dirname` reflects the actual filesystem location.

**Fix**: Use `process.env.JS_BINARY__WORKSPACE` or `process.env.BAZEL_WORKSPACE` for source tree references. Avoid relying on `__dirname` for paths that should be relative to the repository root.

## Debugging Commands

```bash
# List all npm packages available in the hub
bazel query @npm//...

# Show what a specific npm target provides
bazel query 'deps(:node_modules/lodash)' --output=build

# Trace why a package is being fetched
bazel aquery 'mnemonic("NpmImport", deps(@npm//lodash))'

# Show the generated BUILD file for an npm package
bazel query @npm__lodash__4.17.21//:BUILD.bazel --output=build

# Force re-fetch of all npm packages
bazel clean --expunge_async && bazel fetch @npm//...

# Check which packages a target depends on
bazel query 'filter("node_modules", deps(//packages/my-app:lib))'
```

## Migration from rules_nodejs

Migration from `build_bazel_rules_nodejs` to `aspect_rules_js` requires a wholesale rewrite (not incremental):

1. **Switch to pnpm**: Generate `pnpm-lock.yaml` from existing lockfile
2. **Replace WORKSPACE rules**: Swap `yarn_install`/`npm_install` for `npm_translate_lock` (or Bzlmod module extension)
3. **Update BUILD files**: `js_library` providers are incompatible between the two rulesets
4. **Update imports**: `:node_modules/foo` syntax replaces `@npm//foo`
5. **Test thoroughly**: Module resolution behavior differs; phantom deps will surface

The documented path is rules_nodejs -> rules_js 1.x -> rules_js 2.x, each with breaking changes. See the [Aspect migration guide](https://docs.aspect.build/guides/rules_js_migration/).

## Sources

- [rules_js GitHub issues](https://github.com/aspect-build/rules_js/issues)
- [rules_js docs: pnpm integration](https://docs.aspect.build/rulesets/aspect_rules_js/docs/pnpm/)
- [Aspect migration guide](https://docs.aspect.build/guides/rules_js_migration/)
