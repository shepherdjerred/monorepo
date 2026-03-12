"""Repository rules for downloading the Bun runtime."""

load(":versions.bzl", "BUN_SHA256")

_BUN_PLATFORMS = {
    "darwin_arm64": ("darwin", "aarch64"),
    "darwin_amd64": ("darwin", "x64"),
    "linux_arm64": ("linux", "aarch64"),
    "linux_amd64": ("linux", "x64"),
}

def _bun_repo_impl(repository_ctx):
    version = repository_ctx.attr.bun_version
    platform = repository_ctx.attr.platform

    if platform not in _BUN_PLATFORMS:
        fail("Unsupported platform: %s" % platform)

    os_name, arch = _BUN_PLATFORMS[platform]
    archive_name = "bun-%s-%s" % (os_name, arch)
    url = "https://github.com/oven-sh/bun/releases/download/bun-v%s/%s.zip" % (version, archive_name)

    sha256_key = "%s-%s" % (version, platform)
    sha256 = BUN_SHA256.get(sha256_key)
    if not sha256:
        fail("No SHA256 for Bun %s on %s" % (version, platform))

    repository_ctx.download_and_extract(
        url = url,
        stripPrefix = archive_name,
        sha256 = sha256,
    )

    # Inline toolchain.bzl to avoid cross-repo label issues
    repository_ctx.file(
        "toolchain.bzl",
        content = """\
BunToolchainInfo = provider(
    doc = "Information about a Bun toolchain",
    fields = {
        "bun": "File: The Bun binary",
        "version": "string: Bun version (e.g., '1.3.9')",
    },
)

def _bun_toolchain_impl(ctx):
    return [platform_common.ToolchainInfo(
        bun_info = BunToolchainInfo(bun = ctx.file.bun, version = ctx.attr.version),
    )]

bun_toolchain = rule(
    implementation = _bun_toolchain_impl,
    attrs = {
        "bun": attr.label(allow_single_file = True, mandatory = True),
        "version": attr.string(mandatory = True),
    },
)
""",
    )

    repository_ctx.file(
        "BUILD.bazel",
        content = """\
load(":toolchain.bzl", "bun_toolchain")

package(default_visibility = ["//visibility:public"])

exports_files(["bun"])

bun_toolchain(
    name = "bun_toolchain_impl",
    bun = "bun",
    version = "{version}",
)

toolchain(
    name = "bun_toolchain",
    toolchain = ":bun_toolchain_impl",
    toolchain_type = "@monorepo//tools/rules_bun/bun:toolchain_type",
    exec_compatible_with = {exec_constraints},
)
""".format(
            version = version,
            exec_constraints = _platform_constraints(platform),
        ),
    )

bun_repo = repository_rule(
    implementation = _bun_repo_impl,
    attrs = {
        "bun_version": attr.string(mandatory = True),
        "platform": attr.string(mandatory = True),
    },
)

def _platform_constraints(platform):
    constraints = {
        "darwin_arm64": '["@platforms//os:macos", "@platforms//cpu:arm64"]',
        "darwin_amd64": '["@platforms//os:macos", "@platforms//cpu:x86_64"]',
        "linux_arm64": '["@platforms//os:linux", "@platforms//cpu:arm64"]',
        "linux_amd64": '["@platforms//os:linux", "@platforms//cpu:x86_64"]',
    }
    return constraints[platform]
