# @shepherdjerred/release-tools

Wrapper package that pins the `release-please` library and CLI for the
main-branch release lane. The release runner loads the committed manifest,
applies the in-memory npm consumer eligibility filter, and uses the same
filtered manifest for release-PR creation and GitHub tagging. The CLI remains
available for diagnostics, and the version comes from the root lockfile instead
of an ad-hoc fetch. See
"Release refinement providers" in the root
[AGENTS.md](../../AGENTS.md#release-refinement-providers) for the surrounding
release flow.
