"""TypeScript type-check macro - delegates to the package's typecheck npm script.

Runs `bun run typecheck` in the actual source tree for full compatibility.
"""

def typecheck_test(name, srcs, deps = [], tsconfig = "tsconfig.json", data = [], tags = [], **kwargs):
    """TypeScript type checking via the package's typecheck npm script.

    Args:
        name: Target name (conventionally "typecheck")
        srcs: Source files (used for change detection / caching)
        deps: npm and workspace dependencies
        tsconfig: Path to tsconfig.json (default: tsconfig.json)
        data: Additional data files
        tags: Additional tags (merged with default tags)
        **kwargs: Additional args passed to native.sh_test
    """


    # buildifier: disable=native-sh-test
    native.sh_test(
        name = name,
        srcs = ["//tools/bazel:run_npm_script.sh"],
        args = ["typecheck"],
        data = srcs + deps + data + [
            tsconfig,
            "package.json",
        ],
        env = {
            "MONOREPO_PACKAGE": native.package_name(),
        },
        tags = ["typecheck", "local"] + tags,
        **kwargs
    )
