"""Module extensions for rules_bun2."""

load("//tools/rules_bun2/bun/private:bun_install.bzl", "bun_install")

def _bun_modules_impl(module_ctx):
    for mod in module_ctx.modules:
        for install in mod.tags.install:
            bun_install(
                name = install.name,
                bun_lock = install.bun_lock,
                bun_version = install.bun_version,
                package_jsons = install.package_jsons,
                data = install.data,
            )

bun_modules = module_extension(
    implementation = _bun_modules_impl,
    tag_classes = {
        "install": tag_class(
            attrs = {
                "name": attr.string(mandatory = True),
                "bun_lock": attr.label(mandatory = True, allow_single_file = True),
                "bun_version": attr.string(default = "1.3.9"),
                "package_jsons": attr.label_list(mandatory = True, allow_files = ["package.json"]),
                "data": attr.label_list(default = [], allow_files = True),
            },
        ),
    },
)
