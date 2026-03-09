"""Module extensions for the native Bun toolchain and npm dependency management."""

load("//tools/rules_bun/bun/private:bun_install.bzl", "bun_install")
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

##############################################################################
# bun_modules extension — runs bun install to create hermetic npm dep repo
##############################################################################

def _bun_modules_impl(module_ctx):
    for mod in module_ctx.modules:
        for install in mod.tags.install:
            bun_install(
                name = install.name,
                bun_lock = install.bun_lock,
                package_jsons = install.package_jsons,
                data = install.data,
                pnpm_workspace = install.pnpm_workspace,
                bins = install.bins,
            )

bun_modules = module_extension(
    implementation = _bun_modules_impl,
    tag_classes = {
        "install": tag_class(
            attrs = {
                "name": attr.string(mandatory = True),
                "bun_lock": attr.label(mandatory = True, allow_single_file = True),
                "package_jsons": attr.label_list(mandatory = True, allow_files = ["package.json"]),
                "data": attr.label_list(default = [], allow_files = True),
                "pnpm_workspace": attr.label(allow_single_file = True),
                "bins": attr.string_list_dict(default = {}),
            },
        ),
    },
)
