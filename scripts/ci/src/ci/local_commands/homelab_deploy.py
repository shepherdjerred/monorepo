"""Homelab deploy orchestration: images -> versions.ts -> cdk8s -> helm -> argocd."""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from ci.lib import argocd, bazel, buildkite, ghcr, helm, runner
from ci.lib.catalog import ALIASES, DEPLOY_TARGETS, resolve_targets

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("homelab-deploy", help="Full homelab deploy orchestration")
    p.add_argument("--target", nargs="+", help="Target names (supports aliases like scout, tasks)")
    p.add_argument("--all", action="store_true", dest="deploy_all", help="Deploy all targets")
    p.add_argument("--skip-images", action="store_true", help="Skip image push step")
    p.add_argument("--skip-helm", action="store_true", help="Skip helm chart push step")
    p.add_argument("--skip-argocd", action="store_true", help="Skip ArgoCD sync step")
    p.add_argument("--auto-commit", action="store_true", help="Commit versions.ts changes")
    p.add_argument("--wait-healthy", action="store_true", help="Wait for ArgoCD healthy status")
    p.set_defaults(func=run)


def _repo_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
    )
    return Path(result.stdout.strip())


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    dry_run: bool = args.dry_run

    if not args.target and not args.deploy_all:
        print("Error: specify --target or --all", file=sys.stderr)
        print(
            f"\nAvailable targets: {', '.join(sorted(DEPLOY_TARGETS.keys()))}",
            file=sys.stderr,
        )
        print(
            f"Aliases: {', '.join(f'{k} -> {v}' for k, v in ALIASES.items())}",
            file=sys.stderr,
        )
        sys.exit(1)

    # Resolve targets
    if args.deploy_all:
        target_names = list(DEPLOY_TARGETS.keys())
    else:
        try:
            target_names = resolve_targets(args.target, valid_targets=set(DEPLOY_TARGETS.keys()))
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)

    # Collect all images, charts, and argo apps from resolved targets
    all_images: list[dict[str, str]] = []
    all_charts: list[str] = []
    all_argo_apps: list[str] = []
    seen_image_keys: set[str] = set()

    for name in target_names:
        dt = DEPLOY_TARGETS[name]
        for img in dt.images:
            if img["version_key"] not in seen_image_keys:
                all_images.append(img)
                seen_image_keys.add(img["version_key"])
        all_charts.extend(c for c in dt.charts if c not in all_charts)
        all_argo_apps.extend(a for a in dt.argo_apps if a not in all_argo_apps)

    print(f"=== Homelab Deploy (version {config.version}) ===", flush=True)
    print(f"Targets: {', '.join(target_names)}", flush=True)
    print(f"Images to push: {len(all_images)}", flush=True)
    print(f"Charts to push: {', '.join(all_charts)}", flush=True)
    print(f"ArgoCD apps to sync: {', '.join(all_argo_apps)}", flush=True)
    if dry_run:
        print("\n[DRY RUN MODE]\n", flush=True)

    repo_root = _repo_root()
    versions_updated = False

    # Step 1: Push images
    if not args.skip_images and all_images:
        print("\n--- Step 1: Push container images ---", flush=True)
        gh_token = os.environ.get("GH_TOKEN", "")
        if not gh_token and not dry_run:
            print("Error: GH_TOKEN required for image push", file=sys.stderr)
            sys.exit(1)
        if not dry_run:
            ghcr.login(gh_token)
        for img in all_images:
            print(f"  Pushing {img['name']} ({img['target']})...", flush=True)
            output = bazel.run_capture(
                img["target"],
                stamp=True,
                embed_label=config.version,
                dry_run=dry_run,
                dry_run_stdout=f"sha256:{'0' * 64}",
            )
            if dry_run:
                versioned = f"{config.version}@sha256:dry-run-placeholder"
            else:
                versioned = ghcr.format_version_with_digest(config.version, output)
            buildkite.set_metadata(f"digest:{img['version_key']}", versioned)
            if not dry_run:
                print(f"  Digest: {versioned}", flush=True)
    elif args.skip_images:
        print("\n--- Step 1: Push images [SKIPPED] ---", flush=True)

    # Step 2: Update versions.ts
    if not args.skip_images and all_images:
        print("\n--- Step 2: Update versions.ts ---", flush=True)
        versions_file = repo_root / "packages/homelab/src/cdk8s/src/versions.ts"
        content = versions_file.read_text()
        updated = False
        for img in all_images:
            key = img["version_key"]
            digest_value = buildkite.get_metadata(f"digest:{key}")
            if digest_value:
                escaped_key = re.escape(key)
                # versions.ts uses multiline format: key on one line, value on next
                #   "shepherdjerred/birmel":
                #     "1.1.137@sha256:...",
                pattern = f'("{escaped_key}":\\s*\\n\\s*")[^"]*(")'
                replacement = f"\\g<1>{digest_value}\\g<2>"
                new_content = re.sub(pattern, replacement, content)
                if new_content != content:
                    content = new_content
                    updated = True
                    print(f"  Updated {key} -> {digest_value}", flush=True)
        if updated and not dry_run:
            versions_file.write_text(content)
            versions_updated = True
            print("  Written to versions.ts", flush=True)
        elif dry_run and updated:
            print("  [DRY RUN] Would write updated versions.ts", flush=True)
    else:
        print("\n--- Step 2: Update versions.ts [SKIPPED] ---", flush=True)

    # Step 3: Synth cdk8s
    print("\n--- Step 3: Synth cdk8s manifests ---", flush=True)
    cdk8s_dir = repo_root / "packages/homelab/src/cdk8s"
    runner.run(["bun", "run", "build"], cwd=str(cdk8s_dir), dry_run=dry_run)
    if not dry_run:
        print("  cdk8s synthesis complete", flush=True)

    # Step 4: Push Helm charts
    if not args.skip_helm and all_charts:
        print("\n--- Step 4: Push Helm charts ---", flush=True)
        cm_username = os.environ.get("CHARTMUSEUM_USERNAME", "")
        cm_password = os.environ.get("CHARTMUSEUM_PASSWORD", "")
        if (not cm_username or not cm_password) and not dry_run:
            print(
                "Error: CHARTMUSEUM_USERNAME and CHARTMUSEUM_PASSWORD required",
                file=sys.stderr,
            )
            sys.exit(1)
        helm_dir = repo_root / "packages/homelab/src/cdk8s/helm"
        dist_dir = str(repo_root / "packages/homelab/src/cdk8s/dist")
        for chart_name in all_charts:
            chart_dir = str(helm_dir / chart_name)
            print(f"  Pushing {chart_name}...", flush=True)
            chart_path = helm.package(chart_dir, config.version, dist_dir=dist_dir, dry_run=dry_run)
            result = helm.push_to_chartmuseum(
                chart_path,
                username=cm_username or "dry-run",
                password=cm_password or "dry-run",
                dry_run=dry_run,
            )
            print(f"  {result}", flush=True)
    elif args.skip_helm:
        print("\n--- Step 4: Push Helm charts [SKIPPED] ---", flush=True)

    # Step 5: Sync ArgoCD
    if not args.skip_argocd and all_argo_apps:
        print("\n--- Step 5: Sync ArgoCD ---", flush=True)
        argocd_token = os.environ.get("ARGOCD_AUTH_TOKEN", "")
        if not argocd_token and not dry_run:
            print("Error: ARGOCD_AUTH_TOKEN required for ArgoCD sync", file=sys.stderr)
            sys.exit(1)
        for app_name in all_argo_apps:
            print(f"  Syncing {app_name}...", flush=True)
            msg = argocd.sync(app_name, argocd_token or "dry-run", dry_run=dry_run)
            print(f"  {msg}", flush=True)
    elif args.skip_argocd:
        print("\n--- Step 5: Sync ArgoCD [SKIPPED] ---", flush=True)

    # Step 6: Wait healthy
    if args.wait_healthy and not args.skip_argocd and all_argo_apps and not dry_run:
        print("\n--- Step 6: Wait for healthy ---", flush=True)
        argocd_token = os.environ.get("ARGOCD_AUTH_TOKEN", "")
        for app_name in all_argo_apps:
            print(f"  Waiting for {app_name}...", flush=True)
            health = argocd.wait_for_health(app_name, argocd_token)
            print(f"  {app_name}: {health}", flush=True)

    # Step 7: Auto-commit
    if args.auto_commit and not dry_run and versions_updated:
        print("\n--- Step 7: Auto-commit versions.ts ---", flush=True)
        subprocess.run(
            ["git", "add", "packages/homelab/src/cdk8s/src/versions.ts"],
            cwd=str(repo_root),
            check=True,
        )
        subprocess.run(
            ["git", "commit", "-m", f"chore: update deployed image versions ({config.version})"],
            cwd=str(repo_root),
            check=False,
        )

    print(f"\n=== Homelab deploy complete (version {config.version}) ===", flush=True)
