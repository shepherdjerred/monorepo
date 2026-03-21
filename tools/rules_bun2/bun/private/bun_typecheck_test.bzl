"""bun_typecheck_test rule — runs tsc --noEmit via bun."""

load(":common.bzl", "COMMON_ATTRS", "SCRIPT_PREAMBLE", "build_runfiles", "collect_generated_dir_links", "collect_sources", "collect_workspace_dep_links", "get_source_paths")

def _bun_typecheck_test_impl(ctx):
    bun = ctx.toolchains["//tools/rules_bun/bun:toolchain_type"].bun_info.bun

    all_srcs = collect_sources(ctx)
    nm_depset = ctx.attr.node_modules[DefaultInfo].files
    nm_dir = nm_depset.to_list()[0]
    ws_dep_links = collect_workspace_dep_links(ctx)
    gen_dir_links = collect_generated_dir_links(ctx)
    src_paths = get_source_paths(all_srcs, ctx.files.data, ctx.files.extra_files)

    script = ctx.actions.declare_file(ctx.label.name + "_test.sh")
    ctx.actions.write(
        output = script,
        content = SCRIPT_PREAMBLE.format(
            source_files = "\n".join(src_paths),
            nm_root = nm_dir.short_path,
            package_dir = ctx.label.package,
            workspace_dep_links = "\n".join(ws_dep_links),
            generated_dir_links = "\n".join(gen_dir_links),
        ) + _RUN_CMD.format(
            bun = bun.short_path,
            package_dir = ctx.label.package,
        ),
        is_executable = True,
    )

    return [DefaultInfo(
        executable = script,
        runfiles = build_runfiles(ctx, bun, all_srcs, nm_depset),
    )]

_RUN_CMD = """\
# Run tsc --noEmit from the package directory
cd "$WORK/{package_dir}"
exec "$WS_ROOT/{bun}" "$WORK/node_modules/typescript/bin/tsc" --noEmit "$@"
"""

bun_typecheck_test = rule(
    implementation = _bun_typecheck_test_impl,
    test = True,
    attrs = COMMON_ATTRS,
    toolchains = ["//tools/rules_bun/bun:toolchain_type"],
)
