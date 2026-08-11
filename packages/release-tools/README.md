# @shepherdjerred/release-tools

Wrapper package that pins the `release-please` CLI (its only dependency) for
the main-branch release lane. `scripts/release.ts` invokes it as
`bun run --cwd packages/release-tools release-please -- <subcommand>`, so the
CLI version comes from the root lockfile instead of an ad-hoc fetch. See
"Release refinement providers" in the root
[AGENTS.md](../../AGENTS.md#release-refinement-providers) for the surrounding
release flow.
