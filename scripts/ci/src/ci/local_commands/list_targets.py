"""List available targets by category."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ci.lib.catalog import (
    ALIASES,
    DEPLOY_SITES,
    DEPLOY_TARGETS,
    HELM_CHARTS,
    IMAGE_PUSH_TARGETS,
    INFRA_PUSH_TARGETS,
    NPM_PACKAGES,
    TOFU_STACKS,
)

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("list-targets", help="List available targets")
    p.set_defaults(func=run)


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    print("=== homelab-deploy targets ===")
    for name in sorted(DEPLOY_TARGETS.keys()):
        dt = DEPLOY_TARGETS[name]
        imgs = ", ".join(i["name"] for i in dt.images) or "(none)"
        print(f"  {name:<35} images=[{imgs}]  charts={dt.charts}")

    print("\n=== Aliases ===")
    for alias, targets in sorted(ALIASES.items()):
        print(f"  {alias} -> {', '.join(targets)}")

    print("\n=== image-push targets ===")
    for img in IMAGE_PUSH_TARGETS:
        print(f"  {img['name']:<35} {img['target']}")
    for img in INFRA_PUSH_TARGETS:
        print(f"  {img['name']:<35} {img['target']}  (infra)")

    print("\n=== helm-push targets ===")
    for name in HELM_CHARTS:
        print(f"  {name}")

    print("\n=== tofu-apply targets ===")
    for name in TOFU_STACKS:
        print(f"  {name}")

    print("\n=== site-deploy targets ===")
    for site in DEPLOY_SITES:
        print(f"  {site['name']:<35} -> {site['bucket']}")

    print("\n=== npm-publish targets ===")
    for pkg in NPM_PACKAGES:
        print(f"  {pkg['name']:<35} {pkg['dir']}")
