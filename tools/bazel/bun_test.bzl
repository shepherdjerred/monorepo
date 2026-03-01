"""Bun test macro - delegates to the package's test npm script.

Runs `bun run test` in the actual source tree for full compatibility.
"""

def bun_test(name, srcs, deps = [], data = [], tags = [], **kwargs):
    """Bun test runner via the package's test npm script.

    Args:
        name: Target name (conventionally "test")
        srcs: Source files including test files (used for change detection)
        deps: npm and workspace dependencies
        data: Additional runtime data files
        tags: Additional tags (merged with default tags)
        **kwargs: Additional args passed to native.sh_test
    """


    # buildifier: disable=native-sh-test
    native.sh_test(
        name = name,
        srcs = ["//tools/bazel:run_npm_script.sh"],
        args = ["test"],
        data = srcs + deps + data + [
            "package.json",
            "tsconfig.json",
        ],
        env = {
            "MONOREPO_PACKAGE": native.package_name(),
        },
        tags = ["test", "local"] + tags,
        **kwargs
    )
