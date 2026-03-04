"""golangci-lint macro using sh_test for sandboxed execution.

Runs golangci-lint on Go packages inside the Bazel sandbox via a shell wrapper.
"""

load("@rules_shell//shell:sh_test.bzl", "sh_test")

def golangci_lint_test(name, srcs, tags = [], **kwargs):
    """golangci-lint via sh_test.

    Args:
        name: Target name (conventionally "golangci_lint")
        srcs: Go source files and go.mod/go.sum
        tags: Additional tags
        **kwargs: Additional args passed to sh_test
    """
    sh_test(
        name = name,
        srcs = ["//tools/bazel:golangci_lint_runner.sh"],
        data = srcs,
        env = {
            "PKG_DIR": native.package_name(),
        },
        tags = ["lint"] + tags,
        **kwargs
    )
