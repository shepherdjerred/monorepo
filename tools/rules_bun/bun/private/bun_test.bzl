"""bun_test rule implementation."""

load("//tools/rules_bun/bun:providers.bzl", "BunInfo")
load("//tools/rules_bun/bun/private:materialize.bzl", "collect_all_npm_sources", "materialize_tree")

def _bun_test_impl(ctx):
    bun_toolchain = ctx.toolchains["//tools/rules_bun/bun:toolchain_type"]
    bun = bun_toolchain.bun_info.bun

    # Find primary source dep (has package_json) vs npm/workspace deps
    bun_info = None
    extra_workspace_deps = []
    for dep in ctx.attr.deps:
        if BunInfo in dep:
            info = dep[BunInfo]
            if bun_info == None and info.package_json:
                bun_info = info
            else:
                extra_workspace_deps.append(info)
    if not bun_info:
        # Fall back to first BunInfo if no source dep found
        if extra_workspace_deps:
            bun_info = extra_workspace_deps.pop(0)
        else:
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
            workspace_deps = merged_ws,
        )

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
        "deps": attr.label_list(mandatory = True),
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
