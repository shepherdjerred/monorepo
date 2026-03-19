"""Private framework build rule for rules_bun.

This rule is NOT part of the public API. Package BUILD.bazel files
should use the public wrappers (bun_vite_build, bun_astro_build)
from //tools/rules_bun/bun:defs.bzl.
"""

load("//tools/rules_bun/bun:providers.bzl", "BunTreeInfo")

def _bun_build_impl(ctx):
    bun_toolchain = ctx.toolchains["//tools/rules_bun/bun:toolchain_type"]
    bun = bun_toolchain.bun_info.bun
    tree_info = ctx.attr.prepared_tree[BunTreeInfo]

    # Generate env var exports
    env_lines = []
    for k, v in ctx.attr.env.items():
        env_lines.append("export %s=%s" % (k, repr(v)))
    env_block = "\n".join(env_lines)

    out_dir = ctx.actions.declare_directory(ctx.label.name + "_dist")

    launcher = ctx.actions.declare_file(ctx.label.name + "_build_launcher.sh")
    ctx.actions.expand_template(
        template = ctx.file._launcher_template,
        output = launcher,
        substitutions = {
            # Use exec-root paths (not runfiles) for build actions
            "{{BUN_PATH}}": bun.path,
            "{{TREE_PATH}}": tree_info.tree.path,
            "{{PKG_DIR}}": tree_info.pkg_dir,
            "{{OUT_DIR}}": out_dir.path,
            "{{OUTPUT_MODE}}": "directory",
            "{{OUTPUT_SUBDIR}}": ctx.attr.output_dir,
            "{{BUILD_CMD}}": ctx.attr.build_cmd,
            "{{ENV_VARS}}": env_block,
        },
        is_executable = True,
    )

    ctx.actions.run(
        outputs = [out_dir],
        inputs = [tree_info.tree],
        tools = [bun],
        executable = launcher,
        mnemonic = "BunBuild",
        progress_message = "Building %s for %s" % (ctx.attr.build_cmd, ctx.label),
    )

    return [DefaultInfo(files = depset([out_dir]))]

bun_build = rule(
    implementation = _bun_build_impl,
    attrs = {
        "prepared_tree": attr.label(
            mandatory = True,
            providers = [BunTreeInfo],
        ),
        "build_cmd": attr.string(mandatory = True),
        "output_dir": attr.string(default = "dist"),
        "env": attr.string_dict(),
        "_launcher_template": attr.label(
            default = "//tools/rules_bun/bun/private:bun_build.sh.tpl",
            allow_single_file = True,
        ),
    },
    toolchains = ["//tools/rules_bun/bun:toolchain_type"],
)
