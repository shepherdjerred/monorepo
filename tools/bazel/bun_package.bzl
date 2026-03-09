"""Macros for building Bun-native TypeScript packages.

Since Bun can execute TypeScript directly, most packages don't need transpilation.
These macros wrap the common patterns for:
- bun_lib: wraps TS sources for Bun execution (via bun_library)
- bun_binary: creates runnable entry points (via rules_bun bun_binary)
- bun_typecheck: type checking only (via bun_typecheck_test)
"""

load("//tools/rules_bun/bun:defs.bzl", _bun_binary = "bun_binary", _bun_library = "bun_library")
load("//tools/rules_bun/ts:defs.bzl", "bun_typecheck_test")

def bun_lib(name, srcs = None, deps = [], data = [], visibility = ["//visibility:public"], **kwargs):
    """A Bun-native TypeScript library (no transpilation).

    Since Bun runs .ts files directly, we just wrap sources as a bun_library.

    Args:
        name: Target name
        srcs: Source files (defaults to glob(["src/**/*.ts"]))
        deps: npm and workspace dependencies
        data: Runtime data files
        visibility: Bazel visibility
        **kwargs: Additional args passed to bun_library
    """
    if srcs == None:
        srcs = native.glob(["src/**/*.ts"])

    _bun_library(
        name = name,
        srcs = srcs + ["package.json"],
        package_json = "package.json",
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
        **kwargs: Additional args passed to bun_binary
    """
    _bun_binary(
        name = name,
        entry_point = entry_point,
        deps = [lib] + data,
        **kwargs
    )

def bun_typecheck(name, srcs = None, deps = [], tsconfig = "tsconfig.json", **kwargs):
    """Type checking only for a Bun package (tsc --noEmit equivalent).

    Args:
        name: Target name (conventionally "typecheck")
        srcs: Source files (defaults to glob(["src/**/*.ts"]))
        deps: npm and workspace dependencies
        tsconfig: Path to tsconfig.json
        **kwargs: Additional args passed to bun_typecheck_test
    """
    if srcs == None:
        srcs = native.glob(["src/**/*.ts"])

    lib_name = name + "_lib"
    _bun_library(
        name = lib_name,
        srcs = srcs,
        package_json = "package.json",
        deps = deps,
    )

    bun_typecheck_test(
        name = name,
        tsconfig = tsconfig,
        deps = [
            ":" + lib_name,
        ] + deps,
        **kwargs
    )
