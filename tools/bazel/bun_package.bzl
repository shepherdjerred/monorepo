"""Macros for building Bun-native TypeScript packages.

Since Bun can execute TypeScript directly, most packages don't need transpilation.
These macros wrap the common patterns for:
- js_library: wraps TS sources for Bun execution
- js_binary: creates runnable entry points
- ts_project: type checking only (no JS emit)
"""

load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_library")
load("@aspect_rules_ts//ts:defs.bzl", "ts_project")

def bun_lib(name, srcs = None, deps = [], data = [], visibility = ["//visibility:public"], **kwargs):
    """A Bun-native TypeScript library (no transpilation).

    Since Bun runs .ts files directly, we just wrap sources as a js_library.

    Args:
        name: Target name
        srcs: Source files (defaults to glob(["src/**/*.ts"]))
        deps: npm and workspace dependencies
        data: Runtime data files
        visibility: Bazel visibility
        **kwargs: Additional args passed to js_library
    """
    if srcs == None:
        srcs = native.glob(["src/**/*.ts"])

    js_library(
        name = name,
        srcs = srcs + ["package.json"],
        deps = deps,
        data = data,
        visibility = visibility,
        **kwargs
    )

def bun_binary(name, entry_point, lib, data = [], **kwargs):
    """A Bun-native executable.

    Args:
        name: Target name
        entry_point: TypeScript entry point (e.g., "src/index.ts")
        lib: Label of the bun_lib target
        data: Additional runtime data
        **kwargs: Additional args passed to js_binary
    """
    js_binary(
        name = name,
        entry_point = entry_point,
        data = [lib] + data,
        **kwargs
    )

def bun_typecheck(name, srcs = None, deps = [], tsconfig = "tsconfig.json", **kwargs):
    """Type checking only for a Bun package (tsc --noEmit equivalent).

    Args:
        name: Target name (conventionally "typecheck")
        srcs: Source files (defaults to glob(["src/**/*.ts"]))
        deps: npm and workspace dependencies
        tsconfig: Path to tsconfig.json
        **kwargs: Additional args passed to ts_project
    """
    if srcs == None:
        srcs = native.glob(["src/**/*.ts"])

    ts_project(
        name = name,
        srcs = srcs,
        no_emit = True,
        declaration = False,
        tsconfig = tsconfig,
        extends = "//:tsconfig_base",
        validate = False,
        deps = deps,
        **kwargs
    )
