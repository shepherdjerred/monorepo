"""Module extension for registering the native Bun toolchain."""

load(":repositories.bzl", "bun_repo")

# renovate: datasource=github-releases depName=oven-sh/bun
_DEFAULT_BUN_VERSION = "1.3.9"

_PLATFORMS = [
    "darwin_arm64",
    "darwin_amd64",
    "linux_arm64",
    "linux_amd64",
]

def _bun_extension_impl(module_ctx):
    version = _DEFAULT_BUN_VERSION
    for mod in module_ctx.modules:
        for toolchain in mod.tags.toolchain:
            if toolchain.bun_version:
                version = toolchain.bun_version

    for platform in _PLATFORMS:
        bun_repo(
            name = "rules_bun_%s" % platform,
            bun_version = version,
            platform = platform,
        )

bun = module_extension(
    implementation = _bun_extension_impl,
    tag_classes = {
        "toolchain": tag_class(
            attrs = {
                "bun_version": attr.string(default = _DEFAULT_BUN_VERSION),
            },
        ),
    },
)
