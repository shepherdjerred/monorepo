"""Providers for rules_bun."""

BunInfo = provider(
    doc = "Information about a Bun-native library target",
    fields = {
        "target": "Label: the target that created this provider",
        "sources": "depset(File): source files (.ts, .tsx, .js, .jsx, .json)",
        "package_json": "File: the package.json for this package",
        "transitive_sources": "depset(File): sources from this target and all transitive deps",
        "npm_sources": "depset(File): files from npm package dependencies (transitive)",
        "npm_package_store_infos": "depset(NpmPackageStoreInfo): npm dep store infos for linking",
        "workspace_deps": "depset(BunInfo): workspace:* dependencies",
    },
)
