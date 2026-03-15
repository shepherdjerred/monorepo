"""Package and push Helm charts to ChartMuseum.

Usage: uv run -m ci.homelab_helm_push

When BUILDKITE_PARALLEL_JOB is set, pushes only the chart at that index.
Otherwise pushes all charts (for local testing / backwards compatibility).

Required env vars:
  CHARTMUSEUM_USERNAME, CHARTMUSEUM_PASSWORD - ChartMuseum auth
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH, BUILDKITE_COMMIT
Optional env vars:
  BUILDKITE_PARALLEL_JOB - 0-based index into HELM_CHARTS list
  BUILDKITE_PARALLEL_JOB_COUNT - total parallel jobs (should match len(HELM_CHARTS))
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from ci.lib import buildkite, helm
from ci.lib.config import ReleaseConfig

HELM_CHARTS = [
    "ddns",
    "apps",
    "scout-beta",
    "scout-prod",
    "starlight-karma-bot-beta",
    "starlight-karma-bot-prod",
    "redlib",
    "better-skill-capped-fetcher",
    "plausible",
    "birmel",
    "cloudflare-tunnel",
    "media",
    "home",
    "postal",
    "syncthing",
    "golink",
    "freshrss",
    "pokemon",
    "gickup",
    "grafana-db",
    "mcp-gateway",
    "s3-static-sites",
    "kyverno-policies",
    "bugsink",
    "dns-audit",
    "sentinel",
    "tasknotes",
    "bazel-remote",
    "status-page",
]


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


def _get_charts_to_push() -> list[str]:
    """Determine which charts to push based on BUILDKITE_PARALLEL_JOB."""
    parallel_job = os.environ.get("BUILDKITE_PARALLEL_JOB")
    if parallel_job is not None:
        index = int(parallel_job)
        if index >= len(HELM_CHARTS):
            print(f"BUILDKITE_PARALLEL_JOB={index} exceeds chart count ({len(HELM_CHARTS)}), nothing to push", flush=True)
            return []
        chart = HELM_CHARTS[index]
        print(f"Parallel job {index}/{len(HELM_CHARTS)}: pushing chart '{chart}'", flush=True)
        return [chart]
    return list(HELM_CHARTS)


def main() -> None:
    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping Helm push", flush=True)
        return

    cm_username = os.environ.get("CHARTMUSEUM_USERNAME", "")
    cm_password = os.environ.get("CHARTMUSEUM_PASSWORD", "")
    if not cm_username or not cm_password:
        print("Missing required env vars: CHARTMUSEUM_USERNAME, CHARTMUSEUM_PASSWORD", flush=True)
        sys.exit(1)

    repo_root = _repo_root()
    helm_dir = repo_root / "packages/homelab/src/cdk8s/helm"
    dist_dir = str(repo_root / "packages/homelab/src/cdk8s/dist")
    charts = _get_charts_to_push()
    if not charts:
        return

    errors: list[str] = []
    for chart_name in charts:
        chart_dir = str(helm_dir / chart_name)
        if not Path(chart_dir).exists():
            errors.append(f"Chart directory not found: {chart_dir}")
            continue
        try:
            chart_path = helm.package(chart_dir, config.version, dist_dir=dist_dir)
            print(f"  Packaged: {chart_path}", flush=True)
            result = helm.push_to_chartmuseum(chart_path, username=cm_username, password=cm_password)
            print(f"  Published {chart_name}: {result}", flush=True)
        except Exception as e:
            errors.append(f"Helm chart {chart_name}: {e}")

    if errors:
        print(f"\n--- {len(errors)} error(s) during Helm push ---", flush=True)
        for i, err in enumerate(errors, 1):
            print(f"  {i}. {err}", flush=True)
        summary = "\n".join(f"- {e}" for e in errors)
        buildkite.annotate(f"**Helm push errors:**\n{summary}", style="error", context="homelab-helm-push")
        sys.exit(1)

    print(f"\nAll {len(charts)} Helm chart(s) pushed successfully", flush=True)


if __name__ == "__main__":
    main()
