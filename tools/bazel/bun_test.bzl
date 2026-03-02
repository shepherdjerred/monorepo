"""Bun test macro using sh_test for sandboxed execution.

Runs bun test inside the Bazel sandbox via a shell wrapper that invokes
the toolchain Bun binary directly. We use sh_test instead of js_test
because js_test's node wrapper injects --require for fs patches that
are incompatible with Bun's module resolution.
"""

load("@aspect_rules_js//js:defs.bzl", "js_library")
load("@rules_shell//shell:sh_test.bzl", "sh_test")

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

    # Aggregate all runtime deps into a js_library so they appear in runfiles
    lib_name = name + "_lib"
    js_library(
        name = lib_name,
        srcs = srcs + ["package.json", "tsconfig.json"],
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
