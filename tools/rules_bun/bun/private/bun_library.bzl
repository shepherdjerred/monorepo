"""bun_library rule implementation."""

load("//tools/rules_bun/bun:providers.bzl", "BunInfo")

_VALID_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json", ".mts", ".cts", ".mjs", ".cjs", ".d.ts"]

def _bun_library_impl(ctx):
    sources = depset(ctx.files.srcs)
    package_json = ctx.file.package_json

    transitive_sources_list = [sources]
    npm_sources_list = []
    workspace_deps_list = []

    for dep in ctx.attr.deps:
        if BunInfo in dep:
            info = dep[BunInfo]
            transitive_sources_list.append(info.transitive_sources)
            npm_sources_list.append(info.npm_sources)
            workspace_deps_list.append(depset([info], transitive = [info.workspace_deps]))

    transitive_sources = depset(transitive = transitive_sources_list)
    npm_sources = depset(transitive = npm_sources_list)
    workspace_deps = depset(transitive = workspace_deps_list)

    bun_info = BunInfo(
        target = ctx.label,
        sources = sources,
        package_json = package_json,
        package_name = ctx.attr.package_name,
        transitive_sources = transitive_sources,
        npm_sources = npm_sources,
        workspace_deps = workspace_deps,
    )

    default_info = DefaultInfo(
        files = sources,
        runfiles = ctx.runfiles(
            files = ctx.files.srcs + [package_json] + ctx.files.data,
            transitive_files = depset(transitive = [transitive_sources, npm_sources]),
        ),
    )

    return [bun_info, default_info]

bun_library = rule(
    implementation = _bun_library_impl,
    attrs = {
        "srcs": attr.label_list(
            allow_files = _VALID_EXTENSIONS,
            doc = "Source files",
        ),
        "deps": attr.label_list(
            doc = "Dependencies (BunInfo targets)",
        ),
        "package_json": attr.label(
            allow_single_file = ["package.json"],
            mandatory = True,
            doc = "The package.json file",
        ),
        "data": attr.label_list(
            allow_files = True,
            doc = "Additional runtime data files",
        ),
        "package_name": attr.string(
            doc = "npm package name (e.g. @scope/pkg) for workspace dep resolution. Falls back to path-based heuristic if empty.",
        ),
    },
)
