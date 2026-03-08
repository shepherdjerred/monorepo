"""bun_library rule implementation."""

load("@aspect_rules_js//js:providers.bzl", "JsInfo")
load("@aspect_rules_js//npm:providers.bzl", "NpmPackageStoreInfo")
load("//tools/rules_bun/bun:providers.bzl", "BunInfo")

_VALID_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json", ".mts", ".cts", ".mjs", ".cjs", ".d.ts"]

def _bun_library_impl(ctx):
    sources = depset(ctx.files.srcs)
    package_json = ctx.file.package_json

    transitive_sources_list = [sources]
    npm_sources_list = []
    npm_store_infos_list = []
    workspace_deps_list = []

    for dep in ctx.attr.deps:
        if BunInfo in dep:
            info = dep[BunInfo]
            transitive_sources_list.append(info.transitive_sources)
            npm_sources_list.append(info.npm_sources)
            npm_store_infos_list.append(info.npm_package_store_infos)
            workspace_deps_list.append(depset([info], transitive = [info.workspace_deps]))
        elif JsInfo in dep:
            js = dep[JsInfo]
            transitive_sources_list.append(js.transitive_sources)
            npm_sources_list.append(js.npm_sources)
            npm_store_infos_list.append(js.npm_package_store_infos)
        elif NpmPackageStoreInfo in dep:
            store_info = dep[NpmPackageStoreInfo]
            npm_store_infos_list.append(depset([store_info]))
            if hasattr(store_info, "transitive_files") and store_info.transitive_files:
                npm_sources_list.append(store_info.transitive_files)

    transitive_sources = depset(transitive = transitive_sources_list)
    npm_sources = depset(transitive = npm_sources_list)
    npm_package_store_infos = depset(transitive = npm_store_infos_list)
    workspace_deps = depset(transitive = workspace_deps_list)

    bun_info = BunInfo(
        target = ctx.label,
        sources = sources,
        package_json = package_json,
        package_name = ctx.attr.package_name,
        transitive_sources = transitive_sources,
        npm_sources = npm_sources,
        npm_package_store_infos = npm_package_store_infos,
        workspace_deps = workspace_deps,
    )

    js = JsInfo(
        target = ctx.label,
        sources = sources,
        types = depset(),
        transitive_sources = transitive_sources,
        transitive_types = depset(),
        npm_sources = npm_sources,
        npm_package_store_infos = npm_package_store_infos,
    )

    default_info = DefaultInfo(
        files = sources,
        runfiles = ctx.runfiles(
            files = ctx.files.srcs + [package_json] + ctx.files.data,
            transitive_files = depset(transitive = [transitive_sources, npm_sources]),
        ),
    )

    return [bun_info, js, default_info]

bun_library = rule(
    implementation = _bun_library_impl,
    attrs = {
        "srcs": attr.label_list(
            allow_files = _VALID_EXTENSIONS,
            doc = "Source files",
        ),
        "deps": attr.label_list(
            doc = "Dependencies (BunInfo, JsInfo, or NpmPackageStoreInfo targets)",
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
