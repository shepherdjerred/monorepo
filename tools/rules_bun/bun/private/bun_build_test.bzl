"""Private framework check/test rule for rules_bun.

Same as bun_build but test = True — used for astro check and similar
validation commands that produce a stamp file instead of a dist tree.
"""

load("//tools/rules_bun/bun:providers.bzl", "BunTreeInfo")

def _bun_build_test_impl(ctx):
    bun_toolchain = ctx.toolchains["//tools/rules_bun/bun:toolchain_type"]
    bun = bun_toolchain.bun_info.bun
    tree_info = ctx.attr.prepared_tree[BunTreeInfo]

    bun_rp = bun.short_path
    if bun_rp.startswith("../"):
        bun_rp = bun_rp[3:]
    else:
        bun_rp = ctx.workspace_name + "/" + bun_rp

    env_lines = []
    for k, v in ctx.attr.env.items():
        env_lines.append("export %s=%s" % (k, repr(v)))
    env_block = "\n".join(env_lines)

    launcher = ctx.actions.declare_file(ctx.label.name + "_check_launcher.sh")
    ctx.actions.expand_template(
        template = ctx.file._launcher_template,
        output = launcher,
        substitutions = {
            "{{BUN_PATH}}": bun_rp,
            "{{TREE_PATH}}": ctx.workspace_name + "/" + tree_info.tree.short_path,
            "{{PKG_DIR}}": tree_info.pkg_dir,
            "{{BUILD_CMD}}": ctx.attr.build_cmd,
            "{{ENV_VARS}}": env_block,
        },
        is_executable = True,
    )

    return [DefaultInfo(executable = launcher, runfiles = ctx.runfiles(files = [tree_info.tree, bun]))]

bun_build_test = rule(
    implementation = _bun_build_test_impl,
    attrs = {
        "prepared_tree": attr.label(
            mandatory = True,
            providers = [BunTreeInfo],
        ),
        "build_cmd": attr.string(mandatory = True),
        "env": attr.string_dict(),
        "_launcher_template": attr.label(
            default = "//tools/rules_bun/bun/private:bun_build_test.sh.tpl",
            allow_single_file = True,
        ),
    },
    test = True,
    toolchains = ["//tools/rules_bun/bun:toolchain_type"],
)
