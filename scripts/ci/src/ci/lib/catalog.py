"""Shared target catalogs for CI pipeline generation.

Central registry of all build targets, deploy sites, Helm charts,
and deployment mappings used across CI scripts.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Container image push targets
# ---------------------------------------------------------------------------

IMAGE_PUSH_TARGETS: list[dict[str, str]] = [
    {"target": "//packages/birmel:image_push", "version_key": "shepherdjerred/birmel", "name": "birmel"},
    {"target": "//packages/sentinel:image_push", "version_key": "shepherdjerred/sentinel", "name": "sentinel"},
    {
        "target": "//packages/tasknotes-server:image_push",
        "version_key": "shepherdjerred/tasknotes-server",
        "name": "tasknotes-server",
    },
    {
        "target": "//packages/scout-for-lol:image_push",
        "version_key": "shepherdjerred/scout-for-lol/beta",
        "name": "scout-for-lol",
    },
    {
        "target": "//packages/discord-plays-pokemon:image_push",
        "version_key": "shepherdjerred/discord-plays-pokemon",
        "name": "discord-plays-pokemon",
    },
    {
        "target": "//packages/starlight-karma-bot:image_push",
        "version_key": "shepherdjerred/starlight-karma-bot/beta",
        "name": "starlight-karma-bot",
    },
    {
        "target": "//packages/better-skill-capped/fetcher:image_push",
        "version_key": "shepherdjerred/better-skill-capped-fetcher",
        "name": "better-skill-capped-fetcher",
    },
    {
        "target": "//tools/oci:obsidian_headless_push",
        "version_key": "shepherdjerred/obsidian-headless",
        "name": "obsidian-headless",
    },
    {
        "target": "//packages/status-page/api:image_push",
        "version_key": "shepherdjerred/status-page-api",
        "name": "status-page-api",
    },
]

INFRA_PUSH_TARGETS: list[dict[str, str]] = [
    {"target": "//packages/homelab/src/ha:image_push", "version_key": "shepherdjerred/homelab", "name": "homelab"},
    {
        "target": "//packages/homelab/src/deps-email:image_push",
        "version_key": "shepherdjerred/dependency-summary",
        "name": "dependency-summary",
    },
    {
        "target": "//packages/homelab/src/dns-audit:image_push",
        "version_key": "shepherdjerred/dns-audit",
        "name": "dns-audit",
    },
    {
        "target": "//packages/homelab/src/caddy-s3proxy:image_push",
        "version_key": "shepherdjerred/caddy-s3proxy",
        "name": "caddy-s3proxy",
    },
]

# ---------------------------------------------------------------------------
# npm packages
# ---------------------------------------------------------------------------

NPM_PACKAGES: list[dict[str, str]] = [
    {"name": "bun-decompile", "dir": "packages/bun-decompile"},
    {"name": "astro-opengraph-images", "dir": "packages/astro-opengraph-images"},
    {"name": "webring", "dir": "packages/webring"},
    {"name": "helm-types", "dir": "packages/homelab/src/helm-types"},
]

# ---------------------------------------------------------------------------
# Static site deploys
# ---------------------------------------------------------------------------

DEPLOY_SITES: list[dict[str, str | bool]] = [
    {
        "bucket": "sjer-red",
        "name": "sjer.red",
        "build_dir": "packages/sjer.red",
        "build_cmd": "bun run astro build",
        "dist_dir": "packages/sjer.red/dist",
        "needs_playwright": True,
        "workspace_deps": "astro-opengraph-images,webring",
    },
    {
        "bucket": "clauderon",
        "name": "clauderon docs",
        "build_dir": "packages/clauderon/docs",
        "build_cmd": "bun run astro build",
        "dist_dir": "packages/clauderon/docs/dist",
        "workspace_deps": "astro-opengraph-images",
    },
    {
        "bucket": "resume",
        "name": "resume",
        "build_dir": "packages/resume",
        "build_cmd": "",
        "dist_dir": "packages/resume",
    },
    {
        "bucket": "webring",
        "name": "webring",
        "build_dir": "packages/webring",
        "build_cmd": "bun run typedoc",
        "dist_dir": "packages/webring/docs",
    },
    {
        "bucket": "cook",
        "name": "cooklang-rich-preview",
        "build_dir": "packages/cooklang-rich-preview",
        "build_cmd": "bun run astro build",
        "dist_dir": "packages/cooklang-rich-preview/dist",
    },
    {
        "bucket": "status-page",
        "name": "status-page",
        "build_dir": "packages/status-page/web",
        "build_cmd": "bun run astro build",
        "dist_dir": "packages/status-page/web/dist",
    },
]

# ---------------------------------------------------------------------------
# OpenTofu stacks
# ---------------------------------------------------------------------------

TOFU_STACKS: list[str] = ["cloudflare", "github", "seaweedfs"]

TOFU_STACK_LABELS: dict[str, str] = {
    "cloudflare": "Cloudflare DNS",
    "github": "GitHub Config",
    "seaweedfs": "SeaweedFS Config",
}

# ---------------------------------------------------------------------------
# Package-to-site mapping (for change detection)
# ---------------------------------------------------------------------------

PACKAGE_TO_SITE: dict[str, str] = {
    "sjer.red": "sjer-red",
    "resume": "resume",
    "clauderon": "clauderon",
    "webring": "webring",
    "cooklang-rich-preview": "cook",
}

# ---------------------------------------------------------------------------
# Helm charts
# ---------------------------------------------------------------------------

HELM_CHARTS: list[str] = [
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

# ---------------------------------------------------------------------------
# Version keys for digest tracking
# ---------------------------------------------------------------------------

VERSION_KEYS: list[str] = [
    "shepherdjerred/homelab",
    "shepherdjerred/dependency-summary",
    "shepherdjerred/dns-audit",
    "shepherdjerred/caddy-s3proxy",
    "shepherdjerred/sentinel",
    "shepherdjerred/birmel",
    "shepherdjerred/tasknotes-server",
    "shepherdjerred/obsidian-headless",
    "shepherdjerred/starlight-karma-bot/beta",
    "shepherdjerred/better-skill-capped-fetcher",
    "shepherdjerred/discord-plays-pokemon",
    "shepherdjerred/scout-for-lol/beta",
    "shepherdjerred/status-page-api",
]

# ---------------------------------------------------------------------------
# Target aliases (user-friendly shorthand)
# ---------------------------------------------------------------------------

ALIASES: dict[str, list[str]] = {
    "tasks": ["tasknotes"],
    "scout": ["scout-beta", "scout-prod"],
    "karma": ["starlight-karma-bot-beta", "starlight-karma-bot-prod"],
}


def resolve_targets(names: list[str], *, valid_targets: set[str] | None = None) -> list[str]:
    """Expand aliases and validate target names.

    Args:
        names: User-provided target names (may include aliases).
        valid_targets: If provided, validate resolved names against this set.

    Returns:
        Deduplicated list of resolved target names.

    Raises:
        ValueError: If a resolved name is not in valid_targets.
    """
    resolved: list[str] = []
    seen: set[str] = set()
    for name in names:
        expanded = ALIASES.get(name, [name])
        for target in expanded:
            if target not in seen:
                seen.add(target)
                resolved.append(target)
    if valid_targets is not None:
        for target in resolved:
            if target not in valid_targets:
                msg = f"Unknown target {target!r}. Valid targets: {sorted(valid_targets)}"
                raise ValueError(msg)
    return resolved


# ---------------------------------------------------------------------------
# Deploy target mapping (homelab-deploy orchestration)
# ---------------------------------------------------------------------------


def _image_by_name(name: str) -> dict[str, str]:
    """Look up an image push target by its short name."""
    for img in IMAGE_PUSH_TARGETS:
        if img["name"] == name:
            return img
    for img in INFRA_PUSH_TARGETS:
        if img["name"] == name:
            return img
    msg = f"Unknown image name: {name!r}"
    raise KeyError(msg)


@dataclass(frozen=True)
class DeployTarget:
    """Describes everything needed to deploy a single logical application."""

    name: str
    images: list[dict[str, str]] = field(default_factory=list)
    charts: list[str] = field(default_factory=list)
    argo_apps: list[str] = field(default_factory=list)


def _build_deploy_targets() -> dict[str, DeployTarget]:
    """Construct the full DEPLOY_TARGETS mapping."""
    targets: dict[str, DeployTarget] = {}

    # --- Apps with custom images ---
    targets["birmel"] = DeployTarget(
        name="birmel",
        images=[_image_by_name("birmel")],
        charts=["birmel"],
        argo_apps=["birmel"],
    )
    targets["sentinel"] = DeployTarget(
        name="sentinel",
        images=[_image_by_name("sentinel")],
        charts=["sentinel"],
        argo_apps=["sentinel"],
    )
    targets["tasknotes"] = DeployTarget(
        name="tasknotes",
        images=[_image_by_name("tasknotes-server"), _image_by_name("obsidian-headless")],
        charts=["tasknotes"],
        argo_apps=["tasknotes"],
    )
    targets["scout-beta"] = DeployTarget(
        name="scout-beta",
        images=[_image_by_name("scout-for-lol")],
        charts=["scout-beta"],
        argo_apps=["scout-beta"],
    )
    targets["scout-prod"] = DeployTarget(
        name="scout-prod",
        images=[],
        charts=["scout-prod"],
        argo_apps=["scout-prod"],
    )
    targets["starlight-karma-bot-beta"] = DeployTarget(
        name="starlight-karma-bot-beta",
        images=[_image_by_name("starlight-karma-bot")],
        charts=["starlight-karma-bot-beta"],
        argo_apps=["starlight-karma-bot-beta"],
    )
    targets["starlight-karma-bot-prod"] = DeployTarget(
        name="starlight-karma-bot-prod",
        images=[],
        charts=["starlight-karma-bot-prod"],
        argo_apps=["starlight-karma-bot-prod"],
    )
    targets["pokemon"] = DeployTarget(
        name="pokemon",
        images=[_image_by_name("discord-plays-pokemon")],
        charts=["pokemon"],
        argo_apps=["pokemon"],
    )
    targets["better-skill-capped-fetcher"] = DeployTarget(
        name="better-skill-capped-fetcher",
        images=[_image_by_name("better-skill-capped-fetcher")],
        charts=["better-skill-capped-fetcher"],
        argo_apps=["better-skill-capped-fetcher"],
    )
    targets["status-page"] = DeployTarget(
        name="status-page",
        images=[_image_by_name("status-page-api")],
        charts=["status-page"],
        argo_apps=["status-page"],
    )

    # --- Infra apps with custom images ---
    targets["home"] = DeployTarget(
        name="home",
        images=[_image_by_name("homelab")],
        charts=["home"],
        argo_apps=["home"],
    )
    targets["dns-audit"] = DeployTarget(
        name="dns-audit",
        images=[_image_by_name("dns-audit")],
        charts=["dns-audit"],
        argo_apps=["dns-audit"],
    )
    # caddy-s3proxy image is used by the s3-static-sites chart
    targets["s3-static-sites"] = DeployTarget(
        name="s3-static-sites",
        images=[_image_by_name("caddy-s3proxy")],
        charts=["s3-static-sites"],
        argo_apps=["s3-static-sites"],
    )
    # dependency-summary image runs as a CronJob in the apps chart
    targets["dependency-summary"] = DeployTarget(
        name="dependency-summary",
        images=[_image_by_name("dependency-summary")],
        charts=["apps"],
        argo_apps=["apps"],
    )

    # --- Charts with no custom images ---
    chart_only = [
        "ddns",
        "apps",
        "redlib",
        "plausible",
        "cloudflare-tunnel",
        "media",
        "postal",
        "syncthing",
        "golink",
        "freshrss",
        "gickup",
        "grafana-db",
        "mcp-gateway",
        "kyverno-policies",
        "bugsink",
        "bazel-remote",
    ]
    for chart in chart_only:
        targets[chart] = DeployTarget(
            name=chart,
            images=[],
            charts=[chart],
            argo_apps=[chart],
        )

    return targets


DEPLOY_TARGETS: dict[str, DeployTarget] = _build_deploy_targets()
