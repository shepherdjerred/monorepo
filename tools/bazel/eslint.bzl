"""ESLint test macro - delegates to the package's lint npm script.

Runs `bun run lint` in the actual source tree for full compatibility
with the development environment (generated types, resolved deps, etc.).
"""

def eslint_test(name, srcs, config = "eslint.config.ts", deps = [], data = [], tags = [], **kwargs):
    """ESLint test that delegates to the package's lint npm script.

    Args:
        name: Target name (conventionally "lint")
        srcs: Source files to lint (used for change detection / caching)
        config: ESLint config file (default: eslint.config.ts)
        deps: Additional dependencies
        data: Additional data files
        tags: Additional tags (merged with default tags)
        **kwargs: Additional args passed to native.sh_test
    """


    # buildifier: disable=native-sh-test
    native.sh_test(
        name = name,
        srcs = ["//tools/bazel:run_npm_script.sh"],
        args = ["lint"],
        data = srcs + deps + data + [
            config,
            "tsconfig.json",
            "package.json",
        ],
        env = {
            "MONOREPO_PACKAGE": native.package_name(),
        },
        tags = ["lint", "local"] + tags,
        **kwargs
    )
