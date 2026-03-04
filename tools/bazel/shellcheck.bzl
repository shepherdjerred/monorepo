"""ShellCheck test macro using sh_test for sandboxed execution.

Runs ShellCheck on shell scripts inside the Bazel sandbox via a shell
wrapper. We use sh_test (same pattern as bun_test.bzl) because ShellCheck
is a standalone binary invoked via the system PATH, not a Node.js tool.
"""

load("@rules_shell//shell:sh_test.bzl", "sh_test")

def shellcheck_test(name, srcs, tags = [], **kwargs):
    """ShellCheck linter via sh_test.

    Args:
        name: Target name (conventionally "shellcheck")
        srcs: Shell script files to lint
        tags: Additional tags
        **kwargs: Additional args passed to sh_test
    """
    sh_test(
        name = name,
        srcs = ["//tools/bazel:shellcheck_runner.sh"],
        data = srcs,
        args = ["$(location {})".format(src) for src in srcs],
        tags = ["lint"] + tags,
        **kwargs
    )
