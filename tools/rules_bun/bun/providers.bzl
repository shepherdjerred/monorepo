"""Providers for rules_bun."""

BunInfo = provider(
    doc = "Information about a Bun-native library target",
    fields = {
        "target": "Label: the target that created this provider",
        "sources": "depset(File): source files (.ts, .tsx, .js, .jsx, .json)",
        "package_json": "File: the package.json for this package",
        "package_name": "string: npm package name (e.g. @scope/pkg) for workspace dep resolution",
        "transitive_sources": "depset(File): sources from this target and all transitive deps",
        "npm_sources": "depset(File): files from npm package dependencies (transitive)",
        "workspace_deps": "depset(BunInfo): workspace:* dependencies",
    },
)

BunTreeInfo = provider(
    doc = "A shared materialized TreeArtifact for Bun package rules",
    fields = {
        "tree": "File: the materialized TreeArtifact containing all sources, npm deps, and workspace deps",
        "pkg_dir": "string: the package directory within the tree (e.g. 'packages/my-pkg')",
    },
)
