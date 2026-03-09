"""TypeScript type-check macros.

Two variants:
- typecheck_test: Uses bun_typecheck_test for packages without workspace deps.
  Type errors are test failures. Run with: bazel test //packages/<name>:typecheck
- workspace_typecheck_test: Uses sh_test + typecheck_runner.sh for packages
  with workspace:* deps that need symlink setup before tsc runs.
  Run with: bazel test //packages/<name>:typecheck
"""

load("@rules_shell//shell:sh_test.bzl", "sh_test")
load("//tools/rules_bun/bun:defs.bzl", "bun_library")
load("//tools/rules_bun/ts:defs.bzl", "bun_typecheck_test")

def typecheck_test(name, srcs, deps = [], tsconfig = "tsconfig.json", data = [], tags = [], **kwargs):
    """TypeScript type checking via bun_typecheck_test.

    Args:
        name: Target name (conventionally "typecheck")
        srcs: TypeScript source files
        deps: npm and workspace dependencies
        tsconfig: Path to tsconfig.json (default: tsconfig.json)
        data: Additional data files needed at type-check time
        tags: Additional tags
        **kwargs: Additional args passed to bun_typecheck_test
    """

    # We need a bun_library to wrap sources for bun_typecheck_test
    lib_name = name + "_lib"
    bun_library(
        name = lib_name,
        srcs = srcs + data,
        package_json = "package.json",
        deps = deps,
    )

    bun_typecheck_test(
        name = name,
        tsconfig = tsconfig,
        deps = [
            ":" + lib_name,
        ] + deps,
        tags = ["typecheck"] + tags,
        **kwargs
    )

def workspace_typecheck_test(name, srcs, deps = [], data = [], tags = [], env = {}, **kwargs):
    """TypeScript type checking via sh_test + typecheck_runner.sh.

    Use this instead of typecheck_test when the package has workspace:* deps
    that need symlink resolution in the Bazel sandbox. The runner script
    sets up node_modules symlinks for workspace packages before running tsc.

    Args:
        name: Target name (conventionally "typecheck")
        srcs: TypeScript source files
        deps: npm and workspace dependencies
        data: Additional runtime data files
        tags: Additional tags
        env: Environment variables
        **kwargs: Additional args passed to sh_test
    """

    # Aggregate all runtime deps into a bun_library so they appear in runfiles
    lib_name = name + "_lib"
    bun_library(
        name = lib_name,
        srcs = srcs + ["package.json", "tsconfig.json"],
        package_json = "package.json",
        deps = deps,
    )

    sh_test(
        name = name,
        srcs = ["//tools/bazel:typecheck_runner.sh"],
        data = [
            ":" + lib_name,
            "//tools/bun",
            "//:node_modules/typescript",
            "//:tsconfig_base",
        ] + data,
        env = dict(env, **{
            "BUN_TOOL": "$(location //tools/bun)",
            "PKG_DIR": native.package_name(),
        }),
        tags = ["typecheck"] + tags,
        **kwargs
    )
