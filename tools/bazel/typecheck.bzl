"""TypeScript type-check macros.

Two variants:
- typecheck_test: Uses ts_project for packages without workspace deps.
  Type errors are build failures. Run with: bazel build //packages/<name>:typecheck
- workspace_typecheck_test: Uses sh_test + typecheck_runner.sh for packages
  with workspace:* deps that need symlink setup before tsc runs.
  Run with: bazel test //packages/<name>:typecheck

Note: tsBuildInfoFile is intentionally omitted. With no_emit=True, tsc does
not write any output files (including .tsbuildinfo). Declaring one would cause
ts_project to expect an output that never gets written, breaking the build.
Bazel's own action cache already provides equivalent caching — unchanged inputs
produce a cache hit without re-running tsc.
"""

load("@aspect_rules_js//js:defs.bzl", "js_library")
load("@aspect_rules_ts//ts:defs.bzl", "ts_project")
load("@rules_shell//shell:sh_test.bzl", "sh_test")

def typecheck_test(name, srcs, deps = [], tsconfig = "tsconfig.json", extends = "//:tsconfig_base", data = [], tags = [], **kwargs):
    """TypeScript type checking via ts_project --noEmit.

    This produces no output files — it only validates types.
    Success/failure is cached by Bazel.

    Args:
        name: Target name (conventionally "typecheck")
        srcs: TypeScript source files
        deps: npm and workspace dependencies
        tsconfig: Path to tsconfig.json (default: tsconfig.json)
        extends: Label for parent tsconfig (default: //:tsconfig_base).
            Use a ts_config target for intermediate configs in the extends chain.
        data: Additional data files needed at type-check time (e.g. package.json
            for path alias resolution). Note: only JSON files are supported.
        tags: Additional tags
        **kwargs: Additional args passed to ts_project
    """
    ts_project(
        name = name,
        srcs = srcs + data,
        no_emit = True,
        declaration = False,
        tsconfig = tsconfig,
        extends = extends,
        validate = False,
        deps = deps,
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

    # Aggregate all runtime deps into a js_library so they appear in runfiles
    lib_name = name + "_lib"
    js_library(
        name = lib_name,
        srcs = srcs + ["package.json", "tsconfig.json"],
        deps = deps,
    )

    sh_test(
        name = name,
        srcs = ["//tools/bazel:typecheck_runner.sh"],
        data = [
            ":" + lib_name,
            "//tools/bun",
            "//:node_modules/typescript",
        ] + data,
        env = dict(env, **{
            "BUN_TOOL": "$(location //tools/bun)",
            "PKG_DIR": native.package_name(),
        }),
        tags = ["typecheck"] + tags,
        **kwargs
    )
