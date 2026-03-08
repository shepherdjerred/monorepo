"""Native Bun toolchain for Bazel."""

BunToolchainInfo = provider(
    doc = "Information about a Bun toolchain",
    fields = {
        "bun": "File: The Bun binary",
        "version": "string: Bun version (e.g., '1.3.9')",
    },
)

def _bun_toolchain_impl(ctx):
    return [
        platform_common.ToolchainInfo(
            bun_info = BunToolchainInfo(
                bun = ctx.file.bun,
                version = ctx.attr.version,
            ),
        ),
    ]

bun_toolchain = rule(
    implementation = _bun_toolchain_impl,
    attrs = {
        "bun": attr.label(allow_single_file = True, mandatory = True),
        "version": attr.string(mandatory = True),
    },
)
