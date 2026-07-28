---
id: log-2026-07-27-main-buildkite-bindery-smoke-port
type: log
status: in-progress
board: false
---

# Main Buildkite Bindery Smoke Port

## Objective

Restore a fully green `main` Buildkite build without weakening image smoke
coverage or any other quality gate.

## Evidence

- `origin/main` is `45289a30b29a8c0fca520082c1b380f090094f8f`.
- Buildkite build `#6662` passed the full `verify` step and failed in the
  main-only image build.
- The earliest hard error is the Bindery smoke target:
  `listen tcp :8787: bind: address already in use`.
- Shelfbridge and Bindery both execute server smoke stages on port `8787` in
  the same parallel `docker buildx bake` invocation.
- Bindery's pinned upstream source reads `BINDERY_PORT` for both the server and
  the `healthcheck` subcommand, so its smoke target can use a distinct port
  without changing the production image contract.
- Draft PR
  [#1748](https://github.com/shepherdjerred/monorepo/pull/1748) carries commit
  `0d52b1adccbee72dd3796fa991ffe6042c374b28`; its first exact-head Buildkite
  run is
  [#6666](https://buildkite.com/sjerred/monorepo/builds/6666).
- Buildkite `#6666` found a blocking Semgrep result in the new validator's
  variable-built regular expression. The implementation now parses exports
  with a fixed expression and compares the extracted variable name, retaining
  validation without a suppression.

## Remaining

- [x] Add a distinct Bindery smoke port and a regression check for parallel
      server-smoke port uniqueness.
- [x] Reproduce the image smoke solve and run the relevant repository checks.
- [x] Publish the fix through git-spice.
- [ ] Verify the amended current-head PR gates.
- [ ] Merge the fix and follow the resulting main build through all release,
      image, deploy, tag, and version commit-back lanes.

## Session Log — 2026-07-27

### Done

- Assigned distinct build-only smoke ports to Bindery (`18788`) and
  Shelfbridge (`18787`); production listeners remain unchanged.
- Added pipeline validation and unit coverage that require explicit ports,
  match Shelfbridge's probes to its listener, and reject duplicate ports
  across the Bindery, Shelfbridge, and Redlib parallel smoke stages.
- Passed a no-cache parallel local BuildKit solve for Bindery and Shelfbridge,
  including Bindery's patched-upstream Go regression test and both live HTTP
  smoke checks.
- Passed `bun run verify -- --affected` with all 32 tasks successful.
- Published draft PR
  [#1748](https://github.com/shepherdjerred/monorepo/pull/1748) with git-spice.
- Fixed the initial PR run's Semgrep finding with a fixed-expression parser;
  a local `uvx semgrep scan --config auto --error` rerun reported zero
  findings.

### Remaining

- Pass the amended current-head Buildkite remote-builder image dry run and all
  other PR gates.
- Merge the fix, then verify the newest `main` build through image push,
  release, deploy, tag, and version commit-back work.

### Caveats

- The cluster-only `ci` BuildKit endpoint is not reachable from the developer
  shell (`context deadline exceeded`); the local OrbStack builder proved the
  same no-cache parallel targets, and PR Buildkite must provide the
  authoritative remote-builder result.
