"""bun_prepared_tree rule implementation.

Produces a shared TreeArtifact that can be consumed by multiple rules
(bun_test, bun_eslint_test, bun_typecheck_test, bun_binary, bun_build)
instead of each rule materializing its own copy.
"""

load("//tools/rules_bun/bun:providers.bzl", "BunTreeInfo")
load("//tools/rules_bun/bun/private:materialize.bzl", "collect_all_npm_sources", "materialize_tree")
load("//tools/rules_bun/bun/private:resolve_bun_info.bzl", "resolve_bun_info")

def _bun_prepared_tree_impl(ctx):
    bun_info = resolve_bun_info(ctx.attr.deps)

    nm_sources = []
    if ctx.attr.node_modules:
        nm_sources.append(ctx.attr.node_modules)
    additional_npm = collect_all_npm_sources(ctx.attr.deps + nm_sources)

    tree = materialize_tree(
        ctx,
        ctx.label.name,
        bun_info,
        tsconfig = ctx.file.tsconfig,
        extra_files = ctx.files.extra_files,
        prisma_client = ctx.file.prisma_client,
        data_files = ctx.files.data,
        additional_npm_sources = additional_npm,
        hoisted_links = ctx.file._hoisted_links,
    )

    return [
        BunTreeInfo(
            tree = tree,
            pkg_dir = ctx.label.package,
        ),
        DefaultInfo(files = depset([tree])),
    ]

bun_prepared_tree = rule(
    implementation = _bun_prepared_tree_impl,
    attrs = {
        "deps": attr.label_list(mandatory = True),
        "tsconfig": attr.label(allow_single_file = ["tsconfig.json"]),
        "data": attr.label_list(allow_files = True),
        "extra_files": attr.label_list(allow_files = True),
        "prisma_client": attr.label(allow_single_file = True),
        "node_modules": attr.label(
            doc = "Aggregate npm deps target to include all workspace npm packages",
        ),
        "_hoisted_links": attr.label(
            default = "@bun_modules//:hoisted_links.sh",
            allow_single_file = True,
        ),
    },
    toolchains = ["//tools/rules_bun/bun:toolchain_type"],
)
