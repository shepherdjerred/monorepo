"""Cargo-deny license/advisory/ban checking macro using sh_test.

Runs cargo-deny check inside the Bazel sandbox via a shell wrapper.
Requires a deny.toml config and Cargo.toml/Cargo.lock in the package.
Needs network access to fetch advisory database.
"""

load("@rules_shell//shell:sh_test.bzl", "sh_test")

def cargo_deny_test(name, srcs, tags = [], **kwargs):
    """Cargo-deny check via sh_test.

    Args:
        name: Target name (conventionally "cargo_deny")
        srcs: Must include Cargo.toml, Cargo.lock, and deny.toml
        tags: Additional tags
        **kwargs: Additional args passed to sh_test
    """
    sh_test(
        name = name,
        srcs = ["//tools/bazel:cargo_deny_runner.sh"],
        data = srcs,
        env = {
            "PKG_DIR": native.package_name(),
        },
        # requires-network: cargo-deny fetches advisory DB from GitHub
        tags = ["security", "requires-network"] + tags,
        **kwargs
    )
