"""ESLint test macro using js_test for sandboxed execution.

Runs ESLint programmatically via the ESLint Node API inside the
Bazel sandbox. The eslint.config.ts in each package is auto-detected.
"""

load("@aspect_rules_js//js:defs.bzl", "js_test")

def eslint_test(name, srcs, config = "eslint.config.ts", deps = [], data = [], tags = [], **kwargs):
    """ESLint test via js_test.

    Args:
        name: Target name (conventionally "lint")
        srcs: Source files to lint
        config: ESLint config file (default: eslint.config.ts)
        deps: Additional dependencies
        data: Additional data files
        tags: Additional tags
        **kwargs: Additional args passed to js_test
    """
    js_test(
        name = name,
        entry_point = "//tools/bazel:eslint_entry.cjs",
        data = srcs + deps + data + [
            config,
            "tsconfig.json",
            "package.json",
            "//tools/bazel:eslint_entry",
        ],
        no_copy_to_bin = ["//tools/bazel:eslint_entry.cjs"],
        tags = ["lint"] + tags,
        **kwargs
    )
