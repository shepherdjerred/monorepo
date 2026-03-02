"""TypeScript type-check macro using ts_project with no_emit.

Type errors are build failures (not test failures). Run with:
    bazel build //packages/<name>:typecheck

Note: tsBuildInfoFile is intentionally omitted. With no_emit=True, tsc does
not write any output files (including .tsbuildinfo). Declaring one would cause
ts_project to expect an output that never gets written, breaking the build.
Bazel's own action cache already provides equivalent caching — unchanged inputs
produce a cache hit without re-running tsc.
"""

load("@aspect_rules_ts//ts:defs.bzl", "ts_project")

def typecheck_test(name, srcs, deps = [], tsconfig = "tsconfig.json", extends = "//:tsconfig_base", data = [], tags = [], **kwargs):
    """TypeScript type checking via ts_project --noEmit.

    This produces no output files — it only validates types.
    Success/failure is cached by Bazel.

    Args:
        name: Target name (conventionally "typecheck")
        srcs: TypeScript source files
        deps: npm and workspace dependencies
        tsconfig: Path to tsconfig.json (default: tsconfig.json)
        extends: Label for parent tsconfig (default: //:tsconfig_base).
            Use a ts_config target for intermediate configs in the extends chain.
        data: Additional data files needed at type-check time (e.g. package.json
            for path alias resolution). Note: only JSON files are supported.
        tags: Additional tags
        **kwargs: Additional args passed to ts_project
    """
    ts_project(
        name = name,
        srcs = srcs + data,
        no_emit = True,
        declaration = False,
        tsconfig = tsconfig,
        extends = extends,
        validate = False,
        deps = deps,
        tags = ["typecheck"] + tags,
        **kwargs
    )
