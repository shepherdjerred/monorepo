"""Providers for rules_bun2."""

BunInfo = provider(
    doc = "Information about a Bun library target",
    fields = {
        "sources": "depset(File): direct source files",
        "transitive_sources": "depset(File): sources from this target and all transitive deps",
        "package_name": "string: npm package name for workspace dep resolution (e.g. @scope/pkg)",
        "package_dir": "string: package directory relative to workspace root",
    },
)
