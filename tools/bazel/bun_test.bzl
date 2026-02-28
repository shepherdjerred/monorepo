"""Bun test macro for hermetic test execution inside Bazel's sandbox.

Wraps js_test to run `bun test` via bun_test_entry.js.
"""

load("@aspect_rules_js//js:defs.bzl", "js_test")

def bun_test(name, srcs, deps = [], data = [], **kwargs):
    """Hermetic Bun test runner.

    Args:
        name: Target name (conventionally "test")
        srcs: Source files including test files
        deps: npm and workspace dependencies
        data: Additional runtime data files
        **kwargs: Additional args passed to js_test
    """
    js_test(
        name = name,
        entry_point = "//tools/bazel:bun_test_entry.js",
        data = srcs + deps + data + [
            "package.json",
            "tsconfig.json",
        ],
        tags = ["test"],
        **kwargs
    )
