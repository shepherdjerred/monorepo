"""Bun test macro using sh_test for sandboxed execution.

Runs bun test inside the Bazel sandbox via a shell wrapper that invokes
the toolchain Bun binary directly. We use sh_test instead of js_test
because js_test's node wrapper injects --require for fs patches that
are incompatible with Bun's module resolution.
"""

load("@rules_shell//shell:sh_test.bzl", "sh_test")
load("//tools/rules_bun/bun:defs.bzl", "bun_library")

def bun_test(name, srcs, deps = [], data = [], tags = [], env = {}, **kwargs):
    """Bun test runner via sh_test.

    Args:
        name: Target name (conventionally "test")
        srcs: Source files including test files
        deps: npm and workspace dependencies
        data: Additional runtime data files (e.g., .env.test)
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
        srcs = ["//tools/bazel:bun_test_runner.sh"],
        data = [
            ":" + lib_name,
            "//tools/bun",
            "//tools/bazel:bun_test_entry.cjs",
        ] + data,
        env = dict(env, **{
            "BUN_TOOL": "$(location //tools/bun)",
            "ENTRY_POINT": "$(location //tools/bazel:bun_test_entry.cjs)",
            "PKG_DIR": native.package_name(),
        }),
        tags = ["test"] + tags,
        **kwargs
    )
