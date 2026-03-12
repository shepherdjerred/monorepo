"""TypeScript type-check macros.

typecheck_test: Uses bun_typecheck_test for packages.
Type errors are test failures. Run with: bazel test //packages/<name>:typecheck
"""

load("//tools/rules_bun/bun:defs.bzl", "bun_library")
load("//tools/rules_bun/ts:defs.bzl", "bun_typecheck_test")

def typecheck_test(name, srcs, deps = [], tsconfig = "tsconfig.json", data = [], tags = [], **kwargs):
    """TypeScript type checking via bun_typecheck_test.

    Args:
        name: Target name (conventionally "typecheck")
        srcs: TypeScript source files
        deps: npm and workspace dependencies
        tsconfig: Path to tsconfig.json (default: tsconfig.json)
        data: Additional data files needed at type-check time
        tags: Additional tags
        **kwargs: Additional args passed to bun_typecheck_test
    """

    # We need a bun_library to wrap sources for bun_typecheck_test
    lib_name = name + "_lib"
    bun_library(
        name = lib_name,
        srcs = srcs + data,
        package_json = "package.json",
        deps = deps,
    )

    bun_typecheck_test(
        name = name,
        tsconfig = tsconfig,
        deps = [
            ":" + lib_name,
        ] + deps,
        tags = ["typecheck"] + tags,
        **kwargs
    )
