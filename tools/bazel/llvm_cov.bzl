"""Cargo-llvm-cov coverage macro using sh_test.

Runs cargo-llvm-cov inside the Bazel sandbox via a shell wrapper.
Uses the hermetic binary from @multitool.
"""

load("@rules_shell//shell:sh_test.bzl", "sh_test")

def llvm_cov_test(name, srcs, tags = [], **kwargs):
    """Cargo-llvm-cov coverage via sh_test.

    Args:
        name: Target name (conventionally "llvm_cov")
        srcs: Rust source files, Cargo.toml, and Cargo.lock
        tags: Additional tags
        **kwargs: Additional args passed to sh_test
    """
    sh_test(
        name = name,
        srcs = ["//tools/bazel:llvm_cov_runner.sh"],
        data = srcs + ["@multitool//tools/cargo-llvm-cov"],
        env = {
            "PKG_DIR": native.package_name(),
            "CARGO_LLVM_COV_BIN": "$(location @multitool//tools/cargo-llvm-cov)",
        },
        tags = ["manual"] + tags,
        **kwargs
    )
