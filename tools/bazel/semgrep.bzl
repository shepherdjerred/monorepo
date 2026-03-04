"""Semgrep security scanning macro using sh_test for sandboxed execution.

Runs Semgrep static analysis inside the Bazel sandbox via a shell wrapper.
We use sh_test (same pattern as bun_test.bzl) because Semgrep is a standalone
binary invoked via the system PATH, not a Node.js tool.
"""

load("@rules_shell//shell:sh_test.bzl", "sh_test")

def semgrep_test(name, srcs, tags = [], **kwargs):
    """Semgrep security scan via sh_test.

    Args:
        name: Target name (conventionally "semgrep")
        srcs: Source files/directories to scan
        tags: Additional tags
        **kwargs: Additional args passed to sh_test
    """
    sh_test(
        name = name,
        srcs = ["//tools/bazel:semgrep_runner.sh"],
        data = srcs,
        tags = ["security"] + tags,
        **kwargs
    )
