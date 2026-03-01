"""Generate a dynamic Buildkite pipeline based on affected Bazel targets.

Usage: uv run python -m ci.pipeline_generator

Determines which packages changed (via target-determinator), then emits
a Buildkite pipeline JSON to stdout with only the steps needed.

If target-determinator fails or critical infrastructure files changed,
falls back to building everything.
"""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from ci.lib import bazel

CI_BASE_IMAGE = "ghcr.io/shepherdjerred/ci-base:latest"


# Kubernetes pod spec shared across all steps
def _k8s_plugin(
    *,
    cpu: str = "2",
    memory: str = "4Gi",
    secrets: list[str] | None = None,
) -> dict:
    """Build the kubernetes plugin config for a Buildkite step."""
    secret_refs = [{"secretRef": {"name": "buildkite-ci-secrets"}}]
    if secrets:
        for s in secrets:
            secret_refs.append({"secretRef": {"name": s, "optional": True}})

    return {
        "kubernetes": {
            "checkout": {
                "cloneFlags": "--depth=100 --dissociate",
                "fetchFlags": "--depth=100",
            },
            "podSpecPatch": {
                "serviceAccountName": "buildkite-agent-stack-k8s-controller",
                "containers": [
                    {
                        "name": "container-0",
                        "image": CI_BASE_IMAGE,
                        "resources": {"requests": {"cpu": cpu, "memory": memory}},
                        "envFrom": secret_refs,
                    }
                ],
            },
        }
    }


# Minimum number of :bazel: jobs a build must have to qualify as "fully tested".
# With 19 packages × 4 sub-steps per group, a full build has ~76 jobs.
# Threshold of 40 ensures we don't treat partial builds as green.
MIN_GREEN_BAZEL_JOBS = 40


# Files that, if changed, should trigger a full build
INFRA_FILES = {
    "MODULE.bazel",
    "MODULE.bazel.lock",
    "WORKSPACE",
    "WORKSPACE.bazel",
    ".bazelrc",
    ".bazelversion",
    "pnpm-lock.yaml",
    "bun.lock",
    "package.json",
    "tsconfig.json",
}

INFRA_DIRS = {
    ".buildkite/",
    "scripts/ci/",
    "tools/",
}

# Package -> static site bucket mapping for deploy filtering
PACKAGE_TO_SITE = {
    "sjer.red": "sjer-red",
    "webring": "webring",
    "resume": "resume",
    "clauderon": "clauderon-docs",
}

# Resource tiers for per-package build steps
_HEAVY = ("4", "8Gi")
_MEDIUM = ("2", "4Gi")
_LIGHT = ("1", "2Gi")

PACKAGE_RESOURCES: dict[str, tuple[str, str]] = {
    "clauderon": _HEAVY,
    "homelab": _HEAVY,
    "birmel": _MEDIUM,
    "scout-for-lol": _MEDIUM,
    "discord-plays-pokemon": _MEDIUM,
    "sentinel": _MEDIUM,
    "starlight-karma-bot": _MEDIUM,
    "tasknotes-server": _MEDIUM,
    "better-skill-capped": _MEDIUM,
    "sjer.red": _MEDIUM,
}

# Packages that have container image push targets
PACKAGES_WITH_IMAGES = {
    "birmel",
    "sentinel",
    "tasknotes-server",
    "scout-for-lol",
    "discord-plays-pokemon",
    "starlight-karma-bot",
    "better-skill-capped",
}


@dataclass
class AffectedPackages:
    """Result of analyzing affected targets."""

    packages: set[str] = field(default_factory=set)
    build_all: bool = False
    homelab_changed: bool = False
    clauderon_changed: bool = False
    docs_changed: bool = False
    has_image_packages: set[str] = field(default_factory=set)
    has_site_packages: set[str] = field(default_factory=set)


def _get_last_green_commit() -> str | None:
    """Find the commit of the last fully-passing main build via Buildkite API.

    A build qualifies as "green" only if it passed and had at least
    MIN_GREEN_BAZEL_JOBS jobs with ':bazel:' in the name, ensuring we don't
    treat minimal pipelines as fully tested.

    Returns the commit SHA, or None if unavailable.
    """
    token = os.environ.get("BUILDKITE_API_TOKEN") or os.environ.get(
        "BUILDKITE_AGENT_ACCESS_TOKEN"
    )
    if not token:
        print("No Buildkite API token available, skipping green commit lookup", flush=True)
        return None

    org = os.environ.get("BUILDKITE_ORGANIZATION_SLUG", "")
    pipeline = os.environ.get("BUILDKITE_PIPELINE_SLUG", "")
    current_build = os.environ.get("BUILDKITE_BUILD_NUMBER", "")

    if not org or not pipeline:
        print("Missing org/pipeline slug, skipping green commit lookup", flush=True)
        return None

    url = (
        f"https://api.buildkite.com/v2/organizations/{org}"
        f"/pipelines/{pipeline}/builds"
        f"?branch=main&state=passed&per_page=10"
    )

    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            builds = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print(
                "Buildkite API 401: BUILDKITE_API_TOKEN not set or "
                "agent token lacks REST API permissions",
                flush=True,
            )
        else:
            print(f"Buildkite API request failed: {e}", flush=True)
        return None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"Buildkite API request failed: {e}", flush=True)
        return None

    for build in builds:
        # Skip the current build
        if str(build.get("number")) == current_build:
            continue

        jobs = build.get("jobs", [])
        bazel_jobs = [j for j in jobs if ":bazel:" in (j.get("name") or "")]

        if len(bazel_jobs) >= MIN_GREEN_BAZEL_JOBS:
            commit = build.get("commit")
            print(
                f"Last green build: #{build.get('number')} "
                f"({len(bazel_jobs)} bazel jobs, commit {commit[:10]})",
                flush=True,
            )
            return commit

        print(
            f"Build #{build.get('number')} skipped: "
            f"only {len(bazel_jobs)} bazel jobs (need {MIN_GREEN_BAZEL_JOBS})",
            flush=True,
        )

    print("No qualifying green build found", flush=True)
    return None


def _get_base_revision() -> str:
    """Determine the base revision for target-determinator."""
    branch = os.environ.get("BUILDKITE_BRANCH", "")
    pull_request = os.environ.get("BUILDKITE_PULL_REQUEST", "false")

    if pull_request and pull_request != "false":
        # PR: compare against merge base with main
        result = subprocess.run(
            ["git", "merge-base", "HEAD", "origin/main"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()

    if branch == "main":
        # Main branch: compare against last fully-passing build
        green_commit = _get_last_green_commit()
        if green_commit:
            return green_commit
        return "HEAD~1"

    # Feature branch without PR: compare against main
    result = subprocess.run(
        ["git", "merge-base", "HEAD", "origin/main"],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def _ensure_git_depth() -> None:
    """Ensure we have enough git history for target-determinator."""
    # Check if we have a shallow clone
    result = subprocess.run(
        ["git", "rev-parse", "--is-shallow-repository"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.stdout.strip() == "true":
        print("--- Deepening shallow clone for target-determinator", flush=True)
        subprocess.run(
            ["git", "fetch", "--deepen=100"],
            check=False,
        )


def _get_changed_files() -> list[str]:
    """Get list of files changed compared to the base revision."""
    base = _get_base_revision()
    result = subprocess.run(
        ["git", "diff", "--name-only", base, "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return [f.strip() for f in result.stdout.strip().splitlines() if f.strip()]


def _check_infra_changes(changed_files: list[str]) -> bool:
    """Check if any infrastructure files changed that require a full build."""
    for f in changed_files:
        if f in INFRA_FILES:
            print(f"Infrastructure file changed: {f}", flush=True)
            return True
        for d in INFRA_DIRS:
            if f.startswith(d):
                print(f"Infrastructure dir changed: {f}", flush=True)
                return True
    return False


def _extract_package_name(target: str) -> str | None:
    """Extract the package name from a Bazel target label.

    Examples:
        //packages/birmel:image -> birmel
        //packages/scout-for-lol:test -> scout-for-lol
        //packages/better-skill-capped/fetcher:image -> better-skill-capped
        //packages/homelab/src/cdk8s:synth -> homelab
        //packages/clauderon/web/frontend:build -> clauderon
    """
    if not target.startswith("//packages/"):
        return None
    rest = target[len("//packages/"):]
    # Get the top-level package name (first path component)
    parts = rest.split("/")
    if parts:
        return parts[0].split(":")[0]
    return None


def _analyze_targets(targets: list[str]) -> AffectedPackages:
    """Map affected targets to package-level information."""
    result = AffectedPackages()

    for target in targets:
        pkg = _extract_package_name(target)
        if not pkg:
            continue
        result.packages.add(pkg)

        if pkg == "homelab":
            result.homelab_changed = True
        if pkg == "clauderon":
            result.clauderon_changed = True
        if pkg == "docs":
            result.docs_changed = True
        if pkg in PACKAGES_WITH_IMAGES:
            result.has_image_packages.add(pkg)
        if pkg in PACKAGE_TO_SITE:
            result.has_site_packages.add(pkg)

    return result


# All top-level packages with BUILD.bazel files (used when build_all=True)
ALL_PACKAGES = [
    "astro-opengraph-images",
    "better-skill-capped",
    "birmel",
    "bun-decompile",
    "clauderon",
    "discord-plays-pokemon",
    "eslint-config",
    "homelab",
    "monarch",
    "resume",
    "scout-for-lol",
    "sentinel",
    "sjer.red",
    "starlight-karma-bot",
    "tasknotes-server",
    "tasknotes-types",
    "tasks-for-obsidian",
    "tools",
    "webring",
]


def _generate_per_package_steps(package: str, *, stamp_images: bool = False) -> dict:
    """Generate a Buildkite group with build + lint/typecheck/test steps for a package."""
    safe_key = package.replace(".", "-")
    build_key = f"build-{safe_key}"
    cpu, memory = PACKAGE_RESOURCES.get(package, _LIGHT)

    build_cmd = f".buildkite/scripts/bazel-phase.sh //packages/{package}/... build"
    if stamp_images:
        build_cmd += " --stamp-images"

    _retry = {
        "automatic": [
            {"exit_status": -1, "limit": 2},
            {"exit_status": 255, "limit": 2},
        ]
    }

    build_step = {
        "label": ":building_construction: Build",
        "key": build_key,
        "command": build_cmd,
        "timeout_in_minutes": 15,
        "retry": _retry,
        "plugins": [_k8s_plugin(cpu=cpu, memory=memory)],
    }

    phases = [("lint", ":eslint:"), ("typecheck", ":typescript:"), ("test", ":test_tube:")]
    test_steps = []
    for phase, emoji in phases:
        test_steps.append({
            "label": f"{emoji} {phase.title()}",
            "key": f"{phase}-{safe_key}",
            "depends_on": build_key,
            "command": f".buildkite/scripts/bazel-phase.sh //packages/{package}/... {phase}",
            "timeout_in_minutes": 15,
            "retry": _retry,
            "plugins": [_k8s_plugin(cpu="1", memory="2Gi")],
        })

    return {
        "group": f":bazel: {package}",
        "key": f"pkg-{safe_key}",
        "steps": [build_step] + test_steps,
    }


def _generate_quality_gate_step() -> dict:
    """Generate the Quality & Compliance step."""
    return {
        "label": ":mag: Quality & Compliance",
        "key": "quality-gate",
        "command": ".buildkite/scripts/quality-gate.sh",
        "timeout_in_minutes": 10,
        "plugins": [_k8s_plugin(cpu="1", memory="2Gi")],
    }


def _generate_code_review_step() -> dict:
    """Generate the Code Review step (PRs only)."""
    return {
        "label": ":robot_face: Code Review",
        "key": "code-review",
        "if": "build.pull_request.id != null",
        "command": ".buildkite/scripts/code-review.sh",
        "timeout_in_minutes": 30,
        "soft_fail": True,
        "plugins": [_k8s_plugin(secrets=[])],
    }


def _generate_release_step() -> dict:
    """Generate the Release step (main only)."""
    return {
        "label": ":bookmark: Release",
        "key": "release",
        "if": "build.branch == pipeline.default_branch",
        "command": ".buildkite/scripts/release.sh",
        "timeout_in_minutes": 10,
        "plugins": [_k8s_plugin(secrets=[])],
    }


def _generate_publish_step(packages: set[str] | None) -> dict:
    """Generate the Publish step."""
    if packages:
        label = f":package: Publish ({len(packages)} packages)"
    else:
        label = ":package: Publish"
    step: dict = {
        "label": label,
        "key": "publish",
        "if": "build.branch == pipeline.default_branch",
        "depends_on": "release",
        "command": ".buildkite/scripts/publish.sh",
        "timeout_in_minutes": 30,
        "plugins": [_k8s_plugin(secrets=["buildkite-argocd-token"])],
    }
    if packages:
        step["env"] = {"BUILDKITE_PUBLISH_PACKAGES": " ".join(sorted(packages))}
    return step


def _generate_clauderon_release_step() -> dict:
    """Generate the Clauderon Release step."""
    return {
        "label": ":rust: Clauderon Release",
        "key": "clauderon-release",
        "if": "build.branch == pipeline.default_branch",
        "command": ".buildkite/scripts/clauderon-release.sh",
        "timeout_in_minutes": 30,
        "soft_fail": True,
        "depends_on": "release",
        "plugins": [_k8s_plugin(cpu="4", memory="8Gi", secrets=[])],
    }


def _generate_deploy_step(sites: set[str] | None) -> dict:
    """Generate the Deploy step."""
    if sites:
        label = f":ship: Deploy ({len(sites)} sites)"
    else:
        label = ":ship: Deploy"
    step: dict = {
        "label": label,
        "key": "deploy",
        "if": "build.branch == pipeline.default_branch",
        "command": ".buildkite/scripts/deploy.sh",
        "timeout_in_minutes": 30,
        "plugins": [_k8s_plugin(secrets=["buildkite-argocd-token"])],
    }
    if sites:
        step["env"] = {"BUILDKITE_DEPLOY_SITES": " ".join(sorted(sites))}
    return step


def _generate_homelab_release_step() -> dict:
    """Generate the Homelab Release step."""
    return {
        "label": ":kubernetes: Homelab Release",
        "key": "homelab-release",
        "if": "build.branch == pipeline.default_branch",
        "command": ".buildkite/scripts/homelab-release.sh",
        "timeout_in_minutes": 45,
        "plugins": [_k8s_plugin(cpu="4", memory="8Gi", secrets=["buildkite-argocd-token"])],
    }


def _generate_version_commit_back_step() -> dict:
    """Generate the Version Commit-Back step."""
    return {
        "label": ":bookmark: Version Commit-Back",
        "key": "version-commit-back",
        "if": "build.branch == pipeline.default_branch",
        "command": ".buildkite/scripts/version-commit-back.sh",
        "timeout_in_minutes": 10,
        "soft_fail": True,
        "plugins": [_k8s_plugin(secrets=[])],
    }


def _generate_update_readmes_step() -> dict:
    """Generate the Update READMEs step."""
    return {
        "label": ":books: Update READMEs",
        "key": "update-readmes",
        "if": "build.branch == pipeline.default_branch",
        "command": ".buildkite/scripts/update-readmes.sh",
        "timeout_in_minutes": 30,
        "plugins": [_k8s_plugin(secrets=[])],
    }


def generate_pipeline() -> dict:
    """Generate the full dynamic Buildkite pipeline."""
    steps: list[dict | str] = []

    # Ensure we have enough git history
    _ensure_git_depth()

    # Get changed files and check for infra changes
    changed_files = _get_changed_files()
    infra_changed = _check_infra_changes(changed_files)

    # Try to determine affected targets
    affected = AffectedPackages(build_all=True)
    if infra_changed:
        print("Infrastructure files changed, building everything", flush=True)
        affected.build_all = True
        affected.homelab_changed = True
        affected.clauderon_changed = True
        affected.docs_changed = True
    else:
        try:
            base_rev = _get_base_revision()
            print(f"Base revision: {base_rev}", flush=True)
            targets = bazel.affected_targets(base_rev)
            print(f"Affected targets ({len(targets)}):", flush=True)
            for t in targets[:20]:
                print(f"  {t}", flush=True)
            if len(targets) > 20:
                print(f"  ... and {len(targets) - 20} more", flush=True)

            if len(targets) > 500:
                print(f"Too many affected targets ({len(targets)}), building everything", flush=True)
                affected.build_all = True
                affected.homelab_changed = True
                affected.clauderon_changed = True
                affected.docs_changed = True
            elif len(targets) == 0:
                print("No affected targets detected", flush=True)
                affected = AffectedPackages()
            else:
                affected = _analyze_targets(targets)
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            print(f"target-determinator failed ({e}), building everything", flush=True)
            affected.build_all = True
            affected.homelab_changed = True
            affected.clauderon_changed = True
            affected.docs_changed = True

    # If nothing changed at all, emit a minimal pipeline
    if not affected.build_all and not affected.packages:
        steps.append({
            "label": ":white_check_mark: No changes detected",
            "command": "echo 'No affected targets detected, nothing to build.'",
            "plugins": [_k8s_plugin()],
        })
        return {"agents": {"queue": "default"}, "steps": steps}

    # --- Per-package build & test steps (every push) ---
    is_release = os.environ.get("BUILDKITE_BRANCH", "") == "main"
    packages = sorted(ALL_PACKAGES) if affected.build_all else sorted(affected.packages)
    for pkg in packages:
        stamp = pkg in PACKAGES_WITH_IMAGES and is_release
        steps.append(_generate_per_package_steps(pkg, stamp_images=stamp))

    # --- Quality & Compliance (every push) ---
    steps.append(_generate_quality_gate_step())

    # --- Code Review (PRs only) ---
    pr_number = os.environ.get("BUILDKITE_PULL_REQUEST", "false")
    if pr_number not in ("false", "", None):
        steps.append(_generate_code_review_step())

    # --- Main-only steps ---
    has_main_steps = (
        affected.build_all
        or affected.has_image_packages
        or affected.has_site_packages
        or affected.homelab_changed
        or affected.clauderon_changed
    )

    if has_main_steps:
        # Wait gate for main-only steps
        steps.append({"wait": "~", "if": "build.branch == pipeline.default_branch"})

        # Release (always on main when there are releasable changes)
        steps.append(_generate_release_step())

        steps.append({"wait": "~", "if": "build.branch == pipeline.default_branch"})

        # Publish (only if image packages changed or building all)
        if affected.build_all or affected.has_image_packages:
            publish_pkgs = None if affected.build_all else affected.has_image_packages
            steps.append(_generate_publish_step(publish_pkgs))

        # Clauderon Release (only if clauderon changed)
        if affected.build_all or affected.clauderon_changed:
            steps.append(_generate_clauderon_release_step())

        steps.append({"wait": "~", "if": "build.branch == pipeline.default_branch"})

        # Deploy (only if static sites changed)
        if affected.build_all or affected.has_site_packages:
            deploy_sites = None if affected.build_all else {
                PACKAGE_TO_SITE.get(p, p) for p in affected.has_site_packages
            }
            steps.append(_generate_deploy_step(deploy_sites))

        # Homelab Release (only if homelab changed)
        if affected.build_all or affected.homelab_changed:
            steps.append(_generate_homelab_release_step())

        steps.append({"wait": "~", "if": "build.branch == pipeline.default_branch"})

        # Version Commit-Back (if publish or homelab ran)
        if affected.build_all or affected.has_image_packages or affected.homelab_changed:
            steps.append(_generate_version_commit_back_step())

        # Update READMEs (if docs changed or building all)
        if affected.build_all or affected.docs_changed:
            steps.append({"wait": "~", "if": "build.branch == pipeline.default_branch"})
            steps.append(_generate_update_readmes_step())

    return {"agents": {"queue": "default"}, "steps": steps}


def main() -> None:
    # Redirect all diagnostic prints to stderr during pipeline generation,
    # so only the JSON pipeline goes to stdout (for buildkite-agent pipeline upload)
    with contextlib.redirect_stdout(sys.stderr):
        pipeline = generate_pipeline()

    # Output only the JSON to stdout
    json.dump(pipeline, sys.stdout, indent=2)
    print(file=sys.stdout)  # trailing newline


if __name__ == "__main__":
    main()
