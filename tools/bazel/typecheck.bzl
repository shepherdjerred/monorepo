"""TypeScript type-check macro for hermetic checking inside Bazel's sandbox.

Wraps js_test to run `tsc --noEmit` via typecheck_entry.js. This is an
alternative to the ts_project-based bun_typecheck in bun_package.bzl,
offering more flexibility for packages with workspace deps or custom
tsconfig paths.
"""

load("@aspect_rules_js//js:defs.bzl", "js_test")

def typecheck_test(name, srcs, deps = [], tsconfig = "tsconfig.json", data = [], **kwargs):
    """Hermetic TypeScript type checking.

    Args:
        name: Target name (conventionally "typecheck")
        srcs: Source files to type-check
        deps: npm and workspace dependencies
        tsconfig: Path to tsconfig.json (default: tsconfig.json)
        data: Additional data files
        **kwargs: Additional args passed to js_test
    """
    js_test(
        name = name,
        entry_point = "//tools/bazel:typecheck_entry.js",
        data = srcs + deps + data + [
            tsconfig,
            "package.json",
            "//:tsconfig_base",
            ":node_modules/typescript",
        ],
        tags = ["typecheck"],
        **kwargs
    )
