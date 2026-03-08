"""Trivy vulnerability scanning macro using sh_test for sandboxed execution.

Runs Trivy filesystem scan inside the Bazel sandbox via a shell wrapper.
Uses a hermetic Trivy binary from @multitool.
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
        data = srcs + ["@multitool//tools/trivy"],
        env = {
            "TRIVY_SEVERITY": severity,
            "TRIVY_BIN": "$(rootpath @multitool//tools/trivy)",
        },
        tags = ["security"] + tags,
        **kwargs
    )
