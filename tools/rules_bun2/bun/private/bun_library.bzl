"""bun_library rule — groups source files and propagates transitive deps."""

load("//tools/rules_bun2/bun:providers.bzl", "BunInfo")

def _bun_library_impl(ctx):
    sources = depset(ctx.files.srcs)

    transitive = [sources]
    workspace_deps = []
    for dep in ctx.attr.deps:
        if BunInfo in dep:
            transitive.append(dep[BunInfo].transitive_sources)

    transitive_sources = depset(transitive = transitive)

    return [
        DefaultInfo(files = sources),
        BunInfo(
            sources = sources,
            transitive_sources = transitive_sources,
            package_name = ctx.attr.package_name,
            package_dir = ctx.label.package,
        ),
    ]

bun_library = rule(
    implementation = _bun_library_impl,
    attrs = {
        "srcs": attr.label_list(allow_files = True),
        "deps": attr.label_list(providers = [BunInfo]),
        "package_name": attr.string(default = ""),
    },
)
