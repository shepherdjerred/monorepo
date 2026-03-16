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
from pathlib import Path

from ci.lib import bazel

_CI_IMAGE_VERSION_FILE = Path(__file__).resolve().parents[4] / ".buildkite" / "ci-image" / "VERSION"
CI_BASE_IMAGE = f"ghcr.io/shepherdjerred/ci-base:{_CI_IMAGE_VERSION_FILE.read_text().strip()}"


# Kubernetes pod spec shared across all steps
def _k8s_plugin(
    *,
    cpu: str = "1",
    memory: str = "2Gi",
    cpu_limit: str | None = None,
    memory_limit: str | None = None,
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
                        "resources": {
                            "requests": {"cpu": cpu, "memory": memory},
                            "limits": {"cpu": cpu_limit or cpu, "memory": memory_limit or memory},
                        },
                        "envFrom": secret_refs,
                    },
                    {
                        "name": "agent",
                        "resources": {
                            "requests": {"cpu": "100m", "memory": "128Mi"},
                            "limits": {"cpu": "500m", "memory": "256Mi"},
                        },
                    },
                    {
                        "name": "checkout",
                        "resources": {
                            "requests": {"cpu": "100m", "memory": "128Mi"},
                            "limits": {"cpu": "500m", "memory": "256Mi"},
                        },
                    },
                    {
                        "name": "copy-agent",
                        "resources": {
                            "requests": {"cpu": "100m", "memory": "128Mi"},
                            "limits": {"cpu": "500m", "memory": "256Mi"},
                        },
                    },
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
    "resume": "resume",
    "clauderon": "clauderon",
    "webring": "webring",
    "cooklang-rich-preview": "cook",
}

# --- Container image push targets (app images) ---
IMAGE_PUSH_TARGETS: list[dict] = [
    {"target": "//packages/birmel:image_push", "version_key": "shepherdjerred/birmel", "name": "birmel"},
    {"target": "//packages/sentinel:image_push", "version_key": "shepherdjerred/sentinel", "name": "sentinel"},
    {"target": "//packages/tasknotes-server:image_push", "version_key": "shepherdjerred/tasknotes-server", "name": "tasknotes-server"},
    {"target": "//packages/scout-for-lol:image_push", "version_key": "shepherdjerred/scout-for-lol/beta", "name": "scout-for-lol"},
    {"target": "//packages/discord-plays-pokemon:image_push", "version_key": "shepherdjerred/discord-plays-pokemon", "name": "discord-plays-pokemon"},
    {"target": "//packages/starlight-karma-bot:image_push", "version_key": "shepherdjerred/starlight-karma-bot/beta", "name": "starlight-karma-bot"},
    {"target": "//packages/better-skill-capped/fetcher:image_push", "version_key": "shepherdjerred/better-skill-capped-fetcher", "name": "better-skill-capped-fetcher"},
    {"target": "//tools/oci:obsidian_headless_push", "version_key": "shepherdjerred/obsidian-headless", "name": "obsidian-headless"},
    {"target": "//packages/status-page/api:image_push", "version_key": "shepherdjerred/status-page-api", "name": "status-page-api"},
]

# --- Container image push targets (homelab infra images) ---
INFRA_PUSH_TARGETS: list[dict] = [
    {"target": "//packages/homelab/src/ha:image_push", "version_key": "shepherdjerred/homelab", "name": "homelab"},
    {"target": "//packages/homelab/src/deps-email:image_push", "version_key": "shepherdjerred/dependency-summary", "name": "dependency-summary"},
    {"target": "//packages/homelab/src/dns-audit:image_push", "version_key": "shepherdjerred/dns-audit", "name": "dns-audit"},
    {"target": "//packages/homelab/src/caddy-s3proxy:image_push", "version_key": "shepherdjerred/caddy-s3proxy", "name": "caddy-s3proxy"},
]

# --- NPM packages to publish ---
NPM_PACKAGES: list[dict] = [
    {"name": "bun-decompile", "dir": "packages/bun-decompile"},
    {"name": "astro-opengraph-images", "dir": "packages/astro-opengraph-images"},
    {"name": "webring", "dir": "packages/webring"},
    {"name": "helm-types", "dir": "packages/homelab/src/helm-types"},
]

# --- Static sites to deploy ---
DEPLOY_SITES: list[dict] = [
    {"bucket": "sjer-red", "name": "sjer.red", "build_dir": "packages/sjer.red", "build_cmd": "bun run astro build", "dist_dir": "packages/sjer.red/dist", "needs_playwright": True, "workspace_deps": "astro-opengraph-images,webring"},
    {"bucket": "clauderon", "name": "clauderon docs", "build_dir": "packages/clauderon/docs", "build_cmd": "bun run astro build", "dist_dir": "packages/clauderon/docs/dist", "workspace_deps": "astro-opengraph-images"},
    {"bucket": "resume", "name": "resume", "build_dir": "packages/resume", "build_cmd": "", "dist_dir": "packages/resume"},
    {"bucket": "webring", "name": "webring", "build_dir": "packages/webring", "build_cmd": "bun run typedoc", "dist_dir": "packages/webring/docs"},
    {"bucket": "cook", "name": "cooklang-rich-preview", "build_dir": "packages/cooklang-rich-preview", "build_cmd": "bun run astro build", "dist_dir": "packages/cooklang-rich-preview/dist"},
    {"bucket": "status-page", "name": "status-page", "build_dir": "packages/status-page/web", "build_cmd": "bun run astro build", "dist_dir": "packages/status-page/web/dist"},
]

# --- OpenTofu stacks ---
TOFU_STACKS = ["cloudflare", "github", "seaweedfs"]

# Human-friendly names for tofu stacks in Buildkite labels
TOFU_STACK_LABELS = {
    "cloudflare": "Cloudflare DNS",
    "github": "GitHub Config",
    "seaweedfs": "SeaweedFS Config",
}

# Resource tiers for per-package build steps: (cpu_req, mem_req, cpu_limit, mem_limit)
_HEAVY = ("2", "4Gi", "4", "8Gi")
_MEDIUM = ("1", "2Gi", "2", "4Gi")
_LIGHT = ("500m", "1Gi", "1", "2Gi")

_RETRY = {
    "automatic": [
        {"exit_status": -1, "limit": 2},
        {"exit_status": 1, "limit": 2},
        {"exit_status": 3, "limit": 2},
        {"exit_status": 34, "limit": 2},
        {"exit_status": 255, "limit": 2},
    ]
}

PACKAGE_RESOURCES: dict[str, tuple[str, str, str, str]] = {
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
    cooklang_changed: bool = False
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
        if pkg == "cooklang-for-obsidian":
            result.cooklang_changed = True
        if pkg == "docs":
            result.docs_changed = True
        if pkg in PACKAGES_WITH_IMAGES:
            result.has_image_packages.add(pkg)
        if pkg in PACKAGE_TO_SITE:
            result.has_site_packages.add(pkg)

    return result


# All top-level packages with BUILD.bazel files (used when build_all=True)
ALL_PACKAGES = [
    "anki",
    "astro-opengraph-images",
    "better-skill-capped",
    "birmel",
    "bun-decompile",
    "castle-casters",
    "clauderon",
    "cooklang-for-obsidian",
    "discord-plays-pokemon",
    "docs",
    "dotfiles",
    "eslint-config",
    "fonts",
    "homelab",
    "macos-cross-compiler",
    "monarch",
    "resume",
    "scout-for-lol",
    "sentinel",
    "sjer.red",
    "starlight-karma-bot",
    "status-page",
    "tasknotes-server",
    "tasknotes-types",
    "tasks-for-obsidian",
    "terraform-provider-asuswrt",
    "tools",
    "webring",
    "cooklang-rich-preview",
]


def _generate_per_package_steps(package: str) -> dict:
    """Generate a Buildkite group with build + lint/typecheck/test steps for a package."""
    safe_key = package.replace(".", "-")
    build_key = f"build-{safe_key}"
    cpu, memory, cpu_limit, memory_limit = PACKAGE_RESOURCES.get(package, _LIGHT)

    build_cmd = f".buildkite/scripts/bazel-phase.sh //packages/{package}/... build"

    build_step = {
        "label": ":building_construction: Build",
        "key": build_key,
        "command": build_cmd,
        "timeout_in_minutes": 15,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu=cpu, memory=memory, cpu_limit=cpu_limit, memory_limit=memory_limit)],
    }

    phases = [("lint", ":eslint:"), ("typecheck", ":typescript:"), ("test", ":test_tube:")]
    test_steps = []
    for phase, emoji in phases:
        # Use the same resources as the build step for test phases of heavy packages
        if phase == "test" and (cpu, memory, cpu_limit, memory_limit) == _HEAVY:
            phase_cpu, phase_memory, phase_cpu_limit, phase_memory_limit = cpu, memory, cpu_limit, memory_limit
        else:
            phase_cpu, phase_memory, phase_cpu_limit, phase_memory_limit = _LIGHT
        test_steps.append({
            "label": f"{emoji} {phase.title()}",
            "key": f"{phase}-{safe_key}",
            "depends_on": build_key,
            "command": f".buildkite/scripts/bazel-phase.sh //packages/{package}/... {phase}",
            "timeout_in_minutes": 15,
            "retry": _RETRY,
            "plugins": [_k8s_plugin(cpu=phase_cpu, memory=phase_memory, cpu_limit=phase_cpu_limit, memory_limit=phase_memory_limit)],
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
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="1", memory="2Gi")],
    }


def _generate_prettier_step() -> dict:
    """Generate the Prettier formatting check step."""
    return {
        "label": ":art: Prettier",
        "key": "prettier",
        "command": ".buildkite/scripts/prettier.sh",
        "timeout_in_minutes": 10,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="500m", memory="1Gi")],
    }


def _generate_buildifier_step() -> dict:
    """Generate the Buildifier format & lint check step."""
    return {
        "label": ":bazel: Buildifier",
        "key": "buildifier",
        "command": ".buildkite/scripts/buildifier.sh",
        "timeout_in_minutes": 10,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="500m", memory="1Gi")],
    }


def _generate_security_step() -> dict:
    """Generate the root-level shellcheck and hermeticity linting step."""
    return {
        "label": ":shield: Shellcheck & Hermeticity",
        "key": "shellcheck",
        "command": ".buildkite/scripts/bazel-test-targets.sh //tools/bazel:shellcheck //.buildkite:shellcheck //packages/dotfiles:shellcheck //tools/bazel:hermeticity_check",
        "timeout_in_minutes": 10,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="500m", memory="1Gi")],
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


def _safe_key(name: str) -> str:
    """Convert a name to a Buildkite-safe step key."""
    return name.replace(".", "-").replace("/", "-")


# --- Image push step generators ---

def _generate_image_push_step(img: dict, *, depends_on: str = "release") -> dict:
    """Generate a single container image push step."""
    return {
        "label": f":docker: Push {img['name']} to GHCR",
        "key": f"push-{_safe_key(img['name'])}",
        "if": "build.branch == pipeline.default_branch",
        "depends_on": depends_on,
        "command": f".buildkite/scripts/push-image.sh --target {img['target']} --version-key {img['version_key']}",
        "timeout_in_minutes": 15,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="500m", memory="1Gi", secrets=["buildkite-argocd-token"])],
    }


def _generate_publish_images_group(images: list[dict]) -> dict:
    """Generate a group of image push steps."""
    return {
        "group": ":package: Publish Images",
        "key": "publish-images",
        "steps": [_generate_image_push_step(img) for img in images],
    }


def _all_push_keys(images: list[dict]) -> list[str]:
    """Get all step keys for a list of image push targets."""
    return [f"push-{_safe_key(img['name'])}" for img in images]


# --- NPM publish step generators ---

def _generate_npm_publish_step(pkg: dict) -> dict:
    """Generate a single NPM package publish step."""
    return {
        "label": f":npm: Publish {pkg['name']} to NPM",
        "key": f"npm-{_safe_key(pkg['name'])}",
        "if": "build.branch == pipeline.default_branch",
        "depends_on": "release",
        "command": f".buildkite/scripts/publish-npm-package.sh --package-dir {pkg['dir']}",
        "timeout_in_minutes": 10,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="500m", memory="512Mi")],
    }


def _generate_publish_npm_group() -> dict:
    """Generate a group of NPM publish steps."""
    return {
        "group": ":npm: Publish NPM",
        "key": "publish-npm",
        "steps": [_generate_npm_publish_step(pkg) for pkg in NPM_PACKAGES],
    }


# --- Deploy site step generators ---

def _generate_deploy_site_step(site: dict, *, depends_on: list[str]) -> dict:
    """Generate a single site deploy step."""
    args = f"--bucket {site['bucket']} --build-dir {site['build_dir']} --dist-dir {site['dist_dir']}"
    if site.get("build_cmd"):
        args += f" --build-cmd \"{site['build_cmd']}\""
    if site.get("needs_playwright"):
        args += " --needs-playwright"
    if site.get("target") == "r2":
        args += " --target r2"
    if site.get("workspace_deps"):
        args += f" --workspace-deps {site['workspace_deps']}"

    cpu = "1" if site.get("needs_playwright") or site.get("build_cmd") else "500m"
    memory = "2Gi" if site.get("needs_playwright") or site.get("build_cmd") else "512Mi"

    return {
        "label": f":ship: Deploy {site['name']}",
        "key": f"deploy-{_safe_key(site['bucket'])}",
        "if": "build.branch == pipeline.default_branch",
        "depends_on": depends_on,
        "command": f".buildkite/scripts/deploy-site.sh {args}",
        "timeout_in_minutes": 15,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu=cpu, memory=memory, secrets=["buildkite-argocd-token"])],
    }


def _generate_deploy_argocd_step(*, depends_on: list[str], key: str = "deploy-argocd", app: str = "apps") -> dict:
    """Generate an ArgoCD sync step."""
    return {
        "label": ":argocd: Sync ArgoCD Apps",
        "key": key,
        "if": "build.branch == pipeline.default_branch",
        "depends_on": depends_on,
        "command": f".buildkite/scripts/deploy-argocd.sh --app {app}",
        "timeout_in_minutes": 10,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="500m", memory="512Mi", secrets=["buildkite-argocd-token"])],
    }


def _generate_deploy_sites_group(sites: list[dict], *, depends_on: list[str]) -> dict:
    """Generate a group of site deploy steps."""
    return {
        "group": ":ship: Deploy Sites",
        "key": "deploy-sites",
        "steps": [_generate_deploy_site_step(site, depends_on=depends_on) for site in sites],
    }


# --- Homelab infra image step generators ---

def _generate_homelab_images_group() -> dict:
    """Generate a group of homelab infra image push steps."""
    return {
        "group": ":kubernetes: Homelab Images",
        "key": "homelab-images",
        "steps": [_generate_image_push_step(img) for img in INFRA_PUSH_TARGETS],
    }


# --- Homelab Helm step generators ---

def _generate_homelab_cdk8s_step(*, depends_on: list[str]) -> dict:
    """Generate the cdk8s manifest build step."""
    return {
        "label": ":cdk8s: Build cdk8s Manifests",
        "key": "homelab-cdk8s",
        "if": "build.branch == pipeline.default_branch",
        "depends_on": depends_on,
        "command": ".buildkite/scripts/homelab-cdk8s.sh",
        "timeout_in_minutes": 15,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="2", memory="4Gi")],
    }


def _generate_homelab_helm_push_step() -> dict:
    """Generate the Helm chart package + push step with parallelism."""
    from ci.homelab_helm_push import HELM_CHARTS
    return {
        "label": ":helm: Push Helm Chart to ChartMuseum",
        "key": "homelab-helm-push",
        "if": "build.branch == pipeline.default_branch",
        "depends_on": "homelab-cdk8s",
        "command": ".buildkite/scripts/homelab-helm-push.sh",
        "parallelism": len(HELM_CHARTS),
        "timeout_in_minutes": 10,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="500m", memory="1Gi")],
    }


def _generate_homelab_helm_group(*, depends_on: list[str]) -> dict:
    """Generate a group of Helm-related steps."""
    return {
        "group": ":helm: Homelab Helm",
        "key": "homelab-helm",
        "steps": [
            _generate_homelab_cdk8s_step(depends_on=depends_on),
            _generate_homelab_helm_push_step(),
        ],
    }


# --- Homelab Tofu step generators ---

def _generate_tofu_stack_step(stack: str) -> dict:
    """Generate a single OpenTofu stack apply step."""
    label = TOFU_STACK_LABELS.get(stack, stack.title())
    return {
        "label": f":terraform: Apply {label}",
        "key": f"tofu-{stack}",
        "if": "build.branch == pipeline.default_branch",
        "depends_on": "release",
        "command": f".buildkite/scripts/homelab-tofu-stack.sh --stack {stack}",
        "timeout_in_minutes": 15,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="500m", memory="1Gi", secrets=["buildkite-argocd-token"])],
    }


def _generate_homelab_tofu_group() -> dict:
    """Generate a group of OpenTofu stack steps."""
    return {
        "group": ":terraform: Homelab Tofu",
        "key": "homelab-tofu",
        "steps": [_generate_tofu_stack_step(stack) for stack in TOFU_STACKS],
    }


# --- Homelab ArgoCD step generators ---

def _generate_homelab_argocd_sync_step(*, depends_on: list[str]) -> dict:
    """Generate the homelab ArgoCD sync step."""
    return {
        "label": ":argocd: Sync ArgoCD Apps (homelab)",
        "key": "homelab-argocd-sync",
        "if": "build.branch == pipeline.default_branch",
        "depends_on": depends_on,
        "command": ".buildkite/scripts/deploy-argocd.sh --app apps",
        "timeout_in_minutes": 10,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="500m", memory="512Mi", secrets=["buildkite-argocd-token"])],
    }


def _generate_homelab_argocd_health_step() -> dict:
    """Generate the ArgoCD health wait step."""
    return {
        "label": ":heart: Wait for ArgoCD Healthy",
        "key": "homelab-argocd-health",
        "if": "build.branch == pipeline.default_branch",
        "depends_on": "homelab-argocd-sync",
        "command": ".buildkite/scripts/homelab-argocd-health.sh --app apps --timeout 300",
        "timeout_in_minutes": 10,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="500m", memory="512Mi", secrets=["buildkite-argocd-token"])],
    }


# --- Other release steps ---

def _generate_clauderon_release_group() -> dict:
    """Generate the Clauderon Release group: 2 parallel builds + 1 upload."""
    targets = [
        {"target": "x86_64-unknown-linux-gnu", "filename": "clauderon-linux-x86_64", "label": "x86_64", "key": "clauderon-build-x86-64"},
        {"target": "aarch64-unknown-linux-gnu", "filename": "clauderon-linux-arm64", "label": "arm64", "key": "clauderon-build-arm64"},
    ]
    build_steps = []
    for t in targets:
        build_steps.append({
            "label": f":rust: Build clauderon ({t['label']})",
            "key": t["key"],
            "if": "build.branch == pipeline.default_branch",
            "depends_on": "release",
            "command": f".buildkite/scripts/clauderon-build.sh --target {t['target']} --filename {t['filename']}",
            "timeout_in_minutes": 20,
            "retry": _RETRY,
            "plugins": [_k8s_plugin(cpu="2", memory="4Gi", secrets=[])],
        })
    upload_step = {
        "label": ":rust: Upload clauderon binaries",
        "key": "clauderon-upload",
        "if": "build.branch == pipeline.default_branch",
        "depends_on": [t["key"] for t in targets],
        "command": ".buildkite/scripts/clauderon-upload.sh",
        "timeout_in_minutes": 10,
        "retry": _RETRY,
        "plugins": [_k8s_plugin(cpu="500m", memory="512Mi", secrets=[])],
    }
    return {
        "group": ":rust: Clauderon Release",
        "key": "clauderon-release",
        "steps": build_steps + [upload_step],
    }


def _generate_cooklang_release_group() -> dict:
    """Generate the Cooklang Release group: build → push → create release."""
    return {
        "group": ":cook: Cooklang Release",
        "key": "cooklang-release",
        "steps": [
            {
                "label": ":cook: Build cooklang plugin",
                "key": "cooklang-build",
                "if": "build.branch == pipeline.default_branch",
                "depends_on": "release",
                "command": ".buildkite/scripts/cooklang-build.sh",
                "timeout_in_minutes": 10,
                "retry": _RETRY,
                "plugins": [_k8s_plugin(cpu="500m", memory="1Gi")],
            },
            {
                "label": ":cook: Push cooklang to repo",
                "key": "cooklang-push",
                "if": "build.branch == pipeline.default_branch",
                "depends_on": "cooklang-build",
                "command": ".buildkite/scripts/cooklang-push.sh",
                "timeout_in_minutes": 10,
                "retry": _RETRY,
                "plugins": [_k8s_plugin(cpu="500m", memory="512Mi")],
            },
            {
                "label": ":cook: Create cooklang release",
                "key": "cooklang-release-create",
                "if": "build.branch == pipeline.default_branch",
                "depends_on": "cooklang-push",
                "command": ".buildkite/scripts/cooklang-create-release.sh",
                "timeout_in_minutes": 10,
                "retry": _RETRY,
                "plugins": [_k8s_plugin(cpu="500m", memory="512Mi", secrets=[])],
            },
        ],
    }


def _generate_version_commit_back_step(*, depends_on: list[str]) -> dict:
    """Generate the Version Commit-Back step."""
    return {
        "label": ":bookmark: Version Commit-Back",
        "key": "version-commit-back",
        "if": "build.branch == pipeline.default_branch",
        "depends_on": depends_on,
        "command": ".buildkite/scripts/version-commit-back.sh",
        "timeout_in_minutes": 10,
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

    # Check for forced full build via env var or commit message tag
    force_full = os.environ.get("FULL_BUILD", "").lower() == "true"
    commit_msg = os.environ.get("BUILDKITE_MESSAGE", "")
    if "[full-build]" in commit_msg:
        force_full = True

    # Get changed files and check for infra changes
    changed_files = _get_changed_files()
    infra_changed = _check_infra_changes(changed_files)

    # Try to determine affected targets
    affected = AffectedPackages(build_all=True)
    if force_full or infra_changed:
        reason = "Full build requested" if force_full else "Infrastructure files changed"
        print(f"{reason}, building everything", flush=True)
        affected.build_all = True
        affected.homelab_changed = True
        affected.clauderon_changed = True
        affected.cooklang_changed = True
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
                affected.cooklang_changed = True
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
            affected.cooklang_changed = True
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
    packages = sorted(ALL_PACKAGES) if affected.build_all else sorted(affected.packages)
    for pkg in packages:
        steps.append(_generate_per_package_steps(pkg))

    # --- Quality & Compliance (every push) ---
    steps.append(_generate_quality_gate_step())

    # --- Prettier formatting check (every push) ---
    steps.append(_generate_prettier_step())

    # --- Buildifier format & lint check (every push) ---
    steps.append(_generate_buildifier_step())

    # --- Security & Quality (every push) ---
    steps.append(_generate_security_step())

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
        or affected.cooklang_changed
    )

    if has_main_steps:
        # Wait for all build/test to pass before release steps
        steps.append({"wait": "", "if": "build.branch == pipeline.default_branch"})

        # Release (always on main when there are releasable changes)
        steps.append(_generate_release_step())

        # All subsequent steps use depends_on for ordering (no more wait~ gates)

        # --- Publish app images (8 parallel steps) ---
        has_images = affected.build_all or bool(affected.has_image_packages)
        app_push_keys: list[str] = []
        if has_images:
            steps.append(_generate_publish_images_group(IMAGE_PUSH_TARGETS))
            app_push_keys = _all_push_keys(IMAGE_PUSH_TARGETS)

        # --- Publish NPM packages (4 parallel steps) ---
        steps.append(_generate_publish_npm_group())

        # --- Clauderon Release ---
        if affected.build_all or affected.clauderon_changed:
            steps.append(_generate_clauderon_release_group())

        # --- Cooklang Release ---
        if affected.build_all or affected.cooklang_changed:
            steps.append(_generate_cooklang_release_group())

        # --- Deploy sites (6 parallel steps) ---
        if affected.build_all or affected.has_site_packages:
            deploy_depends = app_push_keys if app_push_keys else ["release"]
            if affected.build_all:
                sites_to_deploy = DEPLOY_SITES
            else:
                site_buckets = {PACKAGE_TO_SITE.get(p, p) for p in affected.has_site_packages}
                sites_to_deploy = [s for s in DEPLOY_SITES if s["bucket"] in site_buckets]
            steps.append(_generate_deploy_sites_group(sites_to_deploy, depends_on=deploy_depends))

        # --- Deploy ArgoCD sync (for app images) ---
        if has_images:
            steps.append(_generate_deploy_argocd_step(depends_on=app_push_keys))

        # --- Homelab release (infra images + helm + tofu + argocd) ---
        if affected.build_all or affected.homelab_changed:
            # Homelab infra images (4 parallel)
            steps.append(_generate_homelab_images_group())
            infra_push_keys = _all_push_keys(INFRA_PUSH_TARGETS)

            # Homelab Helm: cdk8s build -> helm chart push (depends on infra images)
            steps.append(_generate_homelab_helm_group(depends_on=infra_push_keys))

            # Homelab Tofu: 3 parallel stacks (independent of images/helm)
            steps.append(_generate_homelab_tofu_group())

            # Homelab ArgoCD sync (depends on helm push + all tofu stacks)
            argocd_depends = ["homelab-helm-push"] + [f"tofu-{s}" for s in TOFU_STACKS]
            steps.append(_generate_homelab_argocd_sync_step(depends_on=argocd_depends))

            # Wait for ArgoCD healthy (depends on sync)
            steps.append(_generate_homelab_argocd_health_step())

        # --- Version Commit-Back ---
        if affected.build_all or bool(affected.has_image_packages) or affected.homelab_changed:
            vcb_deps: list[str] = []
            if has_images:
                vcb_deps.extend(app_push_keys)
            if affected.build_all or affected.homelab_changed:
                vcb_deps.extend(_all_push_keys(INFRA_PUSH_TARGETS))
            steps.append(_generate_version_commit_back_step(depends_on=vcb_deps))

        # --- Update READMEs ---
        if affected.build_all or affected.docs_changed:
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
