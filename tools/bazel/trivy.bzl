"""Trivy vulnerability scanning macro using sh_test for sandboxed execution.

Runs Trivy filesystem scan inside the Bazel sandbox via a shell wrapper.
We use sh_test (same pattern as bun_test.bzl) because Trivy is a standalone
binary invoked via the system PATH, not a Node.js tool.
"""

load("@rules_shell//shell:sh_test.bzl", "sh_test")

def trivy_test(name, srcs, severity = "HIGH,CRITICAL", tags = [], **kwargs):
    """Trivy vulnerability scan via sh_test.

    Args:
        name: Target name (conventionally "trivy")
        srcs: Files/directories to scan
        severity: Comma-separated severity levels to fail on (default: HIGH,CRITICAL)
        tags: Additional tags
        **kwargs: Additional args passed to sh_test
    """
    sh_test(
        name = name,
        srcs = ["//tools/bazel:trivy_runner.sh"],
        data = srcs,
        env = {
            "TRIVY_SEVERITY": severity,
        },
        tags = ["security"] + tags,
        **kwargs
    )
