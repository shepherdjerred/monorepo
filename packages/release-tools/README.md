# @shepherdjerred/release-tools

Wrapper package that pins the `release-please` library and CLI for the
main-branch release lane. The release runner loads the committed manifest,
applies the in-memory npm consumer eligibility filter, and uses the same
filtered manifest for release-PR creation and GitHub tagging. The CLI remains
available for diagnostics, and the version comes from the root lockfile instead
of an ad-hoc fetch. The main-only lane calls `scripts/release.ts`; its refiner
uses the pinned Codex SDK through the repository LLM runtime and keeps inference
credentials out of tool subprocesses.
