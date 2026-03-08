"""bun_eslint_test rule implementation."""

load("//tools/rules_bun/bun:providers.bzl", "BunInfo")
load("//tools/rules_bun/bun/private:materialize.bzl", "collect_all_npm_sources", "materialize_tree")

def _bun_eslint_test_impl(ctx):
    bun_toolchain = ctx.toolchains["//tools/rules_bun/bun:toolchain_type"]
    bun = bun_toolchain.bun_info.bun

    bun_info = None
    extra_workspace_deps = []
    for dep in ctx.attr.deps:
        if BunInfo in dep:
            if bun_info == None:
                bun_info = dep[BunInfo]
            else:
                # Additional BunInfo deps become workspace deps in the tree
                extra_workspace_deps.append(dep[BunInfo])
    if not bun_info:
        fail("No dep provides BunInfo")

    # Merge extra workspace deps into the main bun_info
    if extra_workspace_deps:
        merged_ws = depset(extra_workspace_deps, transitive = [bun_info.workspace_deps])
        merged_npm = depset(transitive = [bun_info.npm_sources] + [d.npm_sources for d in extra_workspace_deps])
        bun_info = BunInfo(
            target = bun_info.target,
            sources = bun_info.sources,
            package_json = bun_info.package_json,
            package_name = bun_info.package_name,
            transitive_sources = bun_info.transitive_sources,
            npm_sources = merged_npm,
            npm_package_store_infos = bun_info.npm_package_store_infos,
            workspace_deps = merged_ws,
        )

    additional_npm = collect_all_npm_sources(ctx.attr.deps)

    tree = materialize_tree(
        ctx,
        ctx.label.name,
        bun_info,
        tsconfig = ctx.file.tsconfig,
        extra_files = ctx.files.extra_files,
        prisma_client = ctx.file.prisma_client,
        data_files = ctx.files.data,
        additional_npm_sources = additional_npm,
    )

    bun_rp = bun.short_path
    if bun_rp.startswith("../"):
        bun_rp = bun_rp[3:]
    else:
        bun_rp = ctx.workspace_name + "/" + bun_rp

    launcher = ctx.actions.declare_file(ctx.label.name + "_eslint_launcher.sh")
    ctx.actions.expand_template(
        template = ctx.file._launcher_template,
        output = launcher,
        substitutions = {
            "{{BUN_PATH}}": bun_rp,
            "{{TREE_PATH}}": ctx.workspace_name + "/" + tree.short_path,
            "{{PKG_DIR}}": ctx.label.package,
        },
        is_executable = True,
    )

    return [DefaultInfo(executable = launcher, runfiles = ctx.runfiles(files = [tree, bun]))]

bun_eslint_test = rule(
    implementation = _bun_eslint_test_impl,
    attrs = {
        "deps": attr.label_list(mandatory = True),
        "tsconfig": attr.label(allow_single_file = ["tsconfig.json"]),
        "data": attr.label_list(allow_files = True),
        "extra_files": attr.label_list(allow_files = True),
        "prisma_client": attr.label(allow_single_file = True),
        "_launcher_template": attr.label(
            default = "//tools/rules_bun/bun/private:bun_eslint_test.sh.tpl",
            allow_single_file = True,
        ),
    },
    test = True,
    toolchains = ["//tools/rules_bun/bun:toolchain_type"],
)
