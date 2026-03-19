"""bun_test rule implementation."""

load("//tools/rules_bun/bun:providers.bzl", "BunTreeInfo")
load("//tools/rules_bun/bun/private:materialize.bzl", "collect_all_npm_sources", "materialize_tree")
load("//tools/rules_bun/bun/private:resolve_bun_info.bzl", "resolve_bun_info")

def _bun_test_impl(ctx):
    bun_toolchain = ctx.toolchains["//tools/rules_bun/bun:toolchain_type"]
    bun = bun_toolchain.bun_info.bun

    if ctx.attr.prepared_tree:
        tree_info = ctx.attr.prepared_tree[BunTreeInfo]
        tree = tree_info.tree
    else:
        if not ctx.attr.deps:
            fail("Either prepared_tree or deps must be provided")
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

    bun_rp = bun.short_path
    if bun_rp.startswith("../"):
        bun_rp = bun_rp[3:]
    else:
        bun_rp = ctx.workspace_name + "/" + bun_rp

    # Generate env var exports
    env_lines = []
    for k, v in ctx.attr.env.items():
        env_lines.append("export %s=%s" % (k, repr(v)))
    env_block = "\n".join(env_lines)

    launcher = ctx.actions.declare_file(ctx.label.name + "_test_launcher.sh")
    ctx.actions.expand_template(
        template = ctx.file._launcher_template,
        output = launcher,
        substitutions = {
            "{{BUN_PATH}}": bun_rp,
            "{{TREE_PATH}}": ctx.workspace_name + "/" + tree.short_path,
            "{{PKG_DIR}}": ctx.label.package,
            "{{BAIL}}": "--bail" if ctx.attr.bail else "",
            "{{ENV_VARS}}": env_block,
        },
        is_executable = True,
    )

    return [DefaultInfo(executable = launcher, runfiles = ctx.runfiles(files = [tree, bun]))]

bun_test = rule(
    implementation = _bun_test_impl,
    attrs = {
        "prepared_tree": attr.label(
            providers = [BunTreeInfo],
            doc = "Pre-built BunTreeInfo to use instead of materializing a new tree",
        ),
        "deps": attr.label_list(),
        "tsconfig": attr.label(allow_single_file = ["tsconfig.json"]),
        "data": attr.label_list(allow_files = True),
        "extra_files": attr.label_list(allow_files = True),
        "prisma_client": attr.label(allow_single_file = True),
        "bail": attr.bool(default = True),
        "node_modules": attr.label(
            doc = "Aggregate npm deps target to include all workspace npm packages",
        ),
        "env": attr.string_dict(),
        "_hoisted_links": attr.label(
            default = "@bun_modules//:hoisted_links.sh",
            allow_single_file = True,
        ),
        "_launcher_template": attr.label(
            default = "//tools/rules_bun/bun/private:bun_test.sh.tpl",
            allow_single_file = True,
        ),
    },
    test = True,
    toolchains = ["//tools/rules_bun/bun:toolchain_type"],
)
