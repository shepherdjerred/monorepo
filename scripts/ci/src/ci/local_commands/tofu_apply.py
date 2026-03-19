"""Apply OpenTofu infrastructure stacks."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ci.lib import tofu
from ci.lib.catalog import TOFU_STACKS

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("tofu-apply", help="Apply OpenTofu stacks")
    p.add_argument("--target", nargs="+", required=True, choices=TOFU_STACKS, help="Stack names")
    p.set_defaults(func=run)


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    dry_run: bool = args.dry_run
    for stack in args.target:
        print(f"Applying tofu stack: {stack}", flush=True)
        output = tofu.plan_and_apply(stack, dry_run=dry_run)
        print(output, flush=True)
