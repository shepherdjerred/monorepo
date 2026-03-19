"""Show or generate version info."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("version", help="Show version info")
    p.set_defaults(func=run)


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    print(f"Version:  {config.version}")
    print(f"Git SHA:  {config.git_sha}")
    print(f"Branch:   {config.branch}")
    print(f"Release:  {config.is_release}")
