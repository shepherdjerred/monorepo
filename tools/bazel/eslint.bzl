"""ESLint test macro — delegates to bun_eslint_test.

This is a thin wrapper for backwards compatibility with BUILD files
that still use eslint_test from tools/bazel.
"""

load("//tools/rules_bun/bun:defs.bzl", "bun_eslint_test")

def eslint_test(name, srcs, config = "eslint.config.ts", deps = [], data = [], tags = [], **kwargs):
    """ESLint test via bun_eslint_test.

    Args:
        name: Target name (conventionally "lint")
        srcs: Source files to lint
        config: ESLint config file (default: eslint.config.ts)
        deps: Additional dependencies
        data: Additional data files
        tags: Additional tags
        **kwargs: Additional args passed to bun_eslint_test
    """
    bun_eslint_test(
        name = name,
        extra_files = [config, "tsconfig.json"] + data,
        deps = srcs + deps,
        tags = ["lint"] + tags,
        **kwargs
    )
