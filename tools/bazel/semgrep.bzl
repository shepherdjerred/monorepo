"""Semgrep security scanning macro using sh_test for sandboxed execution.

Runs Semgrep static analysis inside the Bazel sandbox via a shell wrapper.
Semgrep is not hermetic — it uses the system-installed binary because semgrep's
architecture (OCaml binary + Python scripts) makes pip.parse() insufficient.
Tagged manual so it only runs when explicitly invoked.
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
