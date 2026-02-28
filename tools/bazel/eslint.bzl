"""ESLint test macro for hermetic linting inside Bazel's sandbox.

Wraps js_test to run ESLint programmatically via eslint_entry.js.
The eslint.config.ts in each package is auto-detected by the ESLint API.
"""

load("@aspect_rules_js//js:defs.bzl", "js_test")

def eslint_test(name, srcs, config = "eslint.config.ts", deps = [], data = [], **kwargs):
    """Hermetic ESLint test using Bazel-managed node_modules.

    Args:
        name: Target name (conventionally "lint")
        srcs: Source files to lint
        config: ESLint config file (default: eslint.config.ts)
        deps: Additional dependencies (e.g., workspace packages)
        data: Additional data files
        **kwargs: Additional args passed to js_test
    """
    js_test(
        name = name,
        entry_point = "//tools/bazel:eslint_entry.js",
        data = srcs + deps + data + [
            config,
            "tsconfig.json",
            "package.json",
            ":node_modules/eslint",
            ":node_modules/typescript",
            ":node_modules/typescript-eslint",
            "//packages/eslint-config:pkg",
        ],
        tags = ["lint"],
        **kwargs
    )
