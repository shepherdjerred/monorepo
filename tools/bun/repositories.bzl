"""Repository rules for downloading the Bun runtime."""

# Bun release artifacts follow this naming convention:
#   https://github.com/oven-sh/bun/releases/download/bun-v{version}/bun-{platform}-{arch}.zip
# Inside the zip, the binary is at: bun-{platform}-{arch}/bun

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
        fail("Unsupported platform: %s. Supported: %s" % (platform, _BUN_PLATFORMS.keys()))

    os_name, arch = _BUN_PLATFORMS[platform]
    archive_name = "bun-%s-%s" % (os_name, arch)
    url = "https://github.com/oven-sh/bun/releases/download/bun-v%s/%s.zip" % (version, archive_name)

    repository_ctx.download_and_extract(
        url = url,
        stripPrefix = archive_name,
        sha256 = repository_ctx.attr.sha256,
    )

    # Create bin/ directory structure that rules_nodejs expects
    repository_ctx.execute(["mkdir", "-p", "bin/nodejs/bin"])

    # Create a wrapper script that acts as "node" but runs bun
    is_windows = "windows" in platform
    if is_windows:
        repository_ctx.file(
            "bin/nodejs/bin/node.cmd",
            content = "@echo off\n\"%~dp0\\..\\..\\..\\bun.exe\" %*\n",
            executable = True,
        )
    else:
        repository_ctx.symlink(
            repository_ctx.path("bun"),
            repository_ctx.path("bin/nodejs/bin/node"),
        )

    # Create BUILD file exposing the toolchain
    repository_ctx.file(
        "BUILD.bazel",
        content = """\\\r
load("@rules_nodejs//nodejs:toolchain.bzl", "nodejs_toolchain")\r
\r
package(default_visibility = ["//visibility:public"])\r
\r
exports_files(["bun"])\r
\r
filegroup(\r
    name = "node_files",\r
    srcs = glob(["bin/**"]) + ["bun"],\r
)\r
\r
nodejs_toolchain(\r
    name = "bun_toolchain_impl",\r
    node = "bin/nodejs/bin/node",\r
)\r
\r
toolchain(\r
    name = "bun_toolchain",\r
    toolchain = ":bun_toolchain_impl",\r
    toolchain_type = "@rules_nodejs//nodejs:toolchain_type",\r
    exec_compatible_with = {exec_constraints},\r
)\r
\r
toolchain(\r
    name = "bun_runtime_toolchain",\r
    toolchain = ":bun_toolchain_impl",\r
    toolchain_type = "@rules_nodejs//nodejs:runtime_toolchain_type",\r
    exec_compatible_with = {exec_constraints},\r
)\r
""".format(
            exec_constraints = _platform_constraints(platform),
        ),
    )

bun_repo = repository_rule(
    implementation = _bun_repo_impl,
    attrs = {
        "bun_version": attr.string(mandatory = True),
        "platform": attr.string(mandatory = True),
        "sha256": attr.string(default = ""),
    },
)

def _platform_constraints(platform):
    """Return Bazel platform constraints for a given platform key."""
    constraints = {
        "darwin_arm64": '["@platforms//os:macos", "@platforms//cpu:arm64"]',
        "darwin_amd64": '["@platforms//os:macos", "@platforms//cpu:x86_64"]',
        "linux_arm64": '["@platforms//os:linux", "@platforms//cpu:arm64"]',
        "linux_amd64": '["@platforms//os:linux", "@platforms//cpu:x86_64"]',
    }
    return constraints[platform]
