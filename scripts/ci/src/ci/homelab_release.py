"""Homelab infrastructure release pipeline.

Usage: uv run -m ci.homelab_release

Handles the full homelab release:
  1. Build cdk8s manifests (via Bazel)
  2. Package Helm charts
  3. Push charts to ChartMuseum
  4. OpenTofu apply (argocd, cloudflare, github, seaweedfs)
  5. Trigger ArgoCD sync
  6. Wait for healthy status
  7. (Optional) Update Cloudflare DNS

Required env vars:
  ARGOCD_TOKEN - ArgoCD API bearer token
  CHARTMUSEUM_USERNAME, CHARTMUSEUM_PASSWORD - ChartMuseum auth
  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY - SeaweedFS S3 credentials
  GH_TOKEN - GitHub token for GHCR authentication
  TOFU_GITHUB_TOKEN - GitHub token for OpenTofu stacks (optional)
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH, BUILDKITE_COMMIT
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from ci.lib import argocd, bazel, buildkite, ghcr, helm, tofu
from ci.lib.config import ReleaseConfig


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


REPO_ROOT = _repo_root()

# Helm charts to package and push (matches HELM_CHARTS in .dagger/src/homelab-helm.ts)
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

# Bazel push targets for homelab infra container images.
# These replace the former Docker-built images.
INFRA_PUSH_TARGETS = {
    "//packages/homelab/src/ha:image_push": "shepherdjerred/homelab",
    "//packages/homelab/src/deps-email:image_push": "shepherdjerred/dependency-summary",
    "//packages/homelab/src/dns-audit:image_push": "shepherdjerred/dns-audit",
    "//packages/homelab/src/caddy-s3proxy:image_push": "shepherdjerred/caddy-s3proxy",
}


def main() -> None:
    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping homelab release", flush=True)
        return

    # Validate required credentials on main
    required_vars = ["GH_TOKEN", "CHARTMUSEUM_USERNAME", "CHARTMUSEUM_PASSWORD"]
    missing = [v for v in required_vars if not os.environ.get(v)]
    if missing:
        print(f"Missing required env vars: {', '.join(missing)}", flush=True)
        sys.exit(1)

    errors: list[str] = []

    # --- Build and push infra container images via Bazel oci_push ---
    gh_token = os.environ.get("GH_TOKEN", "")
    infra_digests: dict[str, str] = {}
    if gh_token:
        print("\n--- Build and push infra container images ---", flush=True)
        ghcr.login(gh_token)
        for target, version_key in INFRA_PUSH_TARGETS.items():
            try:
                print(f"\nPushing {target}", flush=True)
                output = bazel.run_capture(target, stamp=True, embed_label=config.version)
                versioned = ghcr.format_version_with_digest(config.version, output)
                infra_digests[version_key] = versioned
                print(f"  Digest: {versioned}", flush=True)
            except Exception as e:
                errors.append(f"Infra image {target}: {e}")

        # Write digests for version_commit_back to consume
        Path("/tmp/infra-digests.json").write_text(json.dumps(infra_digests, indent=2))
        # Store in Buildkite metadata for cross-step sharing
        buildkite.set_metadata("infra_digests", json.dumps(infra_digests))
        print("Stored infra digests in Buildkite metadata", flush=True)
    else:
        print("GH_TOKEN not set, skipping infra image build/push", flush=True)

    # --- Build cdk8s manifests ---
    # cdk8s build runs via bun (cdk8s.yaml has app: false, so bunx cdk8s synth won't work)
    print("\n--- Build cdk8s manifests ---", flush=True)
    subprocess.run(["bun", "install"], cwd=str(REPO_ROOT), check=True)
    subprocess.run(
        ["bun", "run", "build"],
        cwd=str(REPO_ROOT / "packages/homelab/src/cdk8s"),
        check=True,
    )

    # --- Package and push Helm charts ---
    cm_username = os.environ.get("CHARTMUSEUM_USERNAME", "")
    cm_password = os.environ.get("CHARTMUSEUM_PASSWORD", "")
    if not cm_username or not cm_password:
        print("ChartMuseum credentials not set, skipping Helm publish", flush=True)
        sys.exit(1)

    print("\n--- Package and push Helm charts ---", flush=True)
    helm_dir = REPO_ROOT / "packages/homelab/src/cdk8s/helm"
    for chart_name in HELM_CHARTS:
        chart_dir = str(helm_dir / chart_name)
        if not Path(chart_dir).exists():
            errors.append(f"Chart directory not found: {chart_dir}")
            continue
        try:
            chart_path = helm.package(chart_dir, config.version)
            print(f"  Packaged: {chart_path}", flush=True)
            result = helm.push_to_chartmuseum(chart_path, username=cm_username, password=cm_password)
            print(f"  Published {chart_name}: {result}", flush=True)
        except Exception as e:
            errors.append(f"Helm chart {chart_name}: {e}")

    # --- OpenTofu apply ---
    tofu_github_token = os.environ.get("TOFU_GITHUB_TOKEN", "")
    if tofu_github_token:
        print("\n--- OpenTofu apply ---", flush=True)
        for stack in tofu.TOFU_STACKS:
            try:
                result = tofu.plan_and_apply(stack)
                print(f"  {stack}: {result[:200]}", flush=True)
            except Exception as e:
                errors.append(f"OpenTofu {stack}: {e}")
    else:
        print("TOFU_GITHUB_TOKEN not set, skipping OpenTofu", flush=True)

    # --- ArgoCD sync ---
    argocd_token = os.environ.get("ARGOCD_TOKEN", "")
    if argocd_token:
        print("\n--- Trigger ArgoCD sync ---", flush=True)
        try:
            sync_result = argocd.sync("apps", argocd_token)
            print(sync_result, flush=True)

            print("\n--- Wait for ArgoCD healthy ---", flush=True)
            health = argocd.wait_for_health("apps", argocd_token, timeout=300)
            print(f"ArgoCD health: {health}", flush=True)
        except Exception as e:
            errors.append(f"ArgoCD sync/health: {e}")
    else:
        print("ARGOCD_TOKEN not set, skipping ArgoCD sync", flush=True)

    if errors:
        print(f"\n--- {len(errors)} error(s) during homelab release ---", flush=True)
        for i, err in enumerate(errors, 1):
            print(f"  {i}. {err}", flush=True)
        summary = "\n".join(f"- {e}" for e in errors)
        buildkite.annotate(f"**Homelab release errors:**\n{summary}", style="error", context="homelab-release")
        sys.exit(1)

    print("\nHomelab release completed successfully", flush=True)


if __name__ == "__main__":
    main()
