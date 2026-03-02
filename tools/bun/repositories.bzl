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

# SHA256 checksums for Bun releases, keyed by "{version}-{platform}"
_BUN_SHA256 = {
    "1.3.9-darwin_arm64": "cde6a4edf19cf64909158fa5a464a12026fd7f0d79a4a950c10cf0af04266d85",
    "1.3.9-darwin_amd64": "588f4a48740b9a0c366a00f878810ab3ab5e6734d29b7c3cbdd9484b74a007de",
    "1.3.9-linux_arm64": "a2c2862bcc1fd1c0b3a8dcdc8c7efb5e2acd871eb20ed2f17617884ede81c844",
    "1.3.9-linux_amd64": "4680e80e44e32aa718560ceae85d22ecfbf2efb8f3641782e35e4b7efd65a1aa",
}

def _bun_repo_impl(repository_ctx):
    version = repository_ctx.attr.bun_version
    platform = repository_ctx.attr.platform

    if platform not in _BUN_PLATFORMS:
        fail("Unsupported platform: %s. Supported: %s" % (platform, _BUN_PLATFORMS.keys()))

    os_name, arch = _BUN_PLATFORMS[platform]
    archive_name = "bun-%s-%s" % (os_name, arch)
    url = "https://github.com/oven-sh/bun/releases/download/bun-v%s/%s.zip" % (version, archive_name)

    sha256_key = "%s-%s" % (version, platform)
    sha256 = _BUN_SHA256.get(sha256_key)
    if not sha256:
        fail("No SHA256 for Bun %s on %s. Add to _BUN_SHA256." % (version, platform))

    repository_ctx.download_and_extract(
        url = url,
        stripPrefix = archive_name,
        sha256 = sha256,
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
        content = """\
load("@rules_nodejs//nodejs:toolchain.bzl", "nodejs_toolchain")

package(default_visibility = ["//visibility:public"])

exports_files(["bun"])

filegroup(
    name = "node_files",
    srcs = glob(["bin/**"]) + ["bun"],
)

nodejs_toolchain(
    name = "bun_toolchain_impl",
    node = "bin/nodejs/bin/node",
)

toolchain(
    name = "bun_toolchain",
    toolchain = ":bun_toolchain_impl",
    toolchain_type = "@rules_nodejs//nodejs:toolchain_type",
    exec_compatible_with = {exec_constraints},
)

toolchain(
    name = "bun_runtime_toolchain",
    toolchain = ":bun_toolchain_impl",
    toolchain_type = "@rules_nodejs//nodejs:runtime_toolchain_type",
    exec_compatible_with = {exec_constraints},
)
""".format(
            exec_constraints = _platform_constraints(platform),
        ),
    )

bun_repo = repository_rule(
    implementation = _bun_repo_impl,
    attrs = {
        "bun_version": attr.string(mandatory = True),
        "platform": attr.string(mandatory = True),
        "sha256": attr.string(),
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
