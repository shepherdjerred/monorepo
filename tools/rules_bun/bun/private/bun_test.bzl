"""bun_test rule implementation."""

load("//tools/rules_bun/bun:providers.bzl", "BunInfo")
load("//tools/rules_bun/bun/private:materialize.bzl", "collect_all_npm_sources", "materialize_tree")

def _bun_test_impl(ctx):
    bun_toolchain = ctx.toolchains["//tools/rules_bun/bun:toolchain_type"]
    bun = bun_toolchain.bun_info.bun

    bun_info = None
    for dep in ctx.attr.deps:
        if BunInfo in dep:
            bun_info = dep[BunInfo]
            break
    if not bun_info:
        fail("No dep provides BunInfo")

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

    launcher = ctx.actions.declare_file(ctx.label.name + "_test_launcher.sh")
    ctx.actions.expand_template(
        template = ctx.file._launcher_template,
        output = launcher,
        substitutions = {
            "{{BUN_PATH}}": bun_rp,
            "{{TREE_PATH}}": ctx.workspace_name + "/" + tree.short_path,
            "{{PKG_DIR}}": ctx.label.package,
            "{{BAIL}}": "--bail" if ctx.attr.bail else "",
        },
        is_executable = True,
    )

    return [DefaultInfo(executable = launcher, runfiles = ctx.runfiles(files = [tree, bun]))]

bun_test = rule(
    implementation = _bun_test_impl,
    attrs = {
        "deps": attr.label_list(mandatory = True),
        "tsconfig": attr.label(allow_single_file = ["tsconfig.json"]),
        "data": attr.label_list(allow_files = True),
        "extra_files": attr.label_list(allow_files = True),
        "prisma_client": attr.label(allow_single_file = True),
        "bail": attr.bool(default = True),
        "env": attr.string_dict(),
        "_launcher_template": attr.label(
            default = "//tools/rules_bun/bun/private:bun_test.sh.tpl",
            allow_single_file = True,
        ),
    },
    test = True,
    toolchains = ["//tools/rules_bun/bun:toolchain_type"],
)
