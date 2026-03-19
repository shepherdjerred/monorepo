"""Shared helper for resolving BunInfo from deps."""

load("//tools/rules_bun/bun:providers.bzl", "BunInfo")

def resolve_bun_info(deps):
    """Find the primary BunInfo (with package_json) and merge extra workspace deps.

    Scans deps for BunInfo providers. The first dep with a package_json is
    treated as the primary source package. All other BunInfo deps are merged
    in as workspace dependencies.

    Args:
        deps: list of targets that may provide BunInfo.

    Returns:
        BunInfo: a merged provider with all workspace deps folded in.
    """
    bun_info = None
    extra_workspace_deps = []
    for dep in deps:
        if BunInfo in dep:
            info = dep[BunInfo]
            if bun_info == None and info.package_json:
                bun_info = info
            else:
                extra_workspace_deps.append(info)
    if not bun_info:
        if extra_workspace_deps:
            bun_info = extra_workspace_deps.pop(0)
        else:
            fail("No dep provides BunInfo")

    if extra_workspace_deps:
        merged_ws = depset(extra_workspace_deps, transitive = [bun_info.workspace_deps])
        merged_npm = depset(transitive = [bun_info.npm_sources] + [d.npm_sources for d in extra_workspace_deps])
        bun_info = BunInfo(
            target = bun_info.target,
            sources = bun_info.sources,
            package_json = bun_info.package_json,
            package_name = bun_info.package_name,
            transitive_sources = bun_info.transitive_sources,
            npm_sources = merged_npm,
            workspace_deps = merged_ws,
        )

    return bun_info
