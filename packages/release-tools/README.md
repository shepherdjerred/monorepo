# @shepherdjerred/release-tools

Wrapper package that pins the `release-please` library and CLI for the
main-branch release lane. The release runner loads the committed manifest,
applies the in-memory npm consumer eligibility filter, and uses the same
filtered manifest for release-PR creation and GitHub tagging. The CLI remains
available for diagnostics, and the version comes from the root lockfile instead
of an ad-hoc fetch. The main-only lane calls `scripts/release/release.ts`; its refiner
uses the pinned Codex SDK through the repository LLM runtime and keeps inference
credentials out of tool subprocesses.

Each temporary repository is initialized with a blobless partial clone
(`--filter=blob:none`) so `release-please` reads full commit history and HEAD
files without downloading historical blobs. For `release-pr`, target revision
and npm eligibility resolve after the clone finishes; for `github-release`,
target revision and SHA preflight run first and skip cloning entirely when no
merged `autorelease: pending` pull requests exist on the target branch.
Revision checks still reject main movement during manifest loading or around
release mutations; a failed check remains a release failure.

Run its tests with `bun run --cwd packages/release-tools test`. The consuming
root scripts' typecheck also checks the runner and its regression fixtures.
