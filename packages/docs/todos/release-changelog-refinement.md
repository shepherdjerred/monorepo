---
id: release-changelog-refinement
status: active
origin: packages/docs/plans/2026-07-13_ci-parity-implementation.md
source_marker: true
---

# Restore the release-please CHANGELOG refinement step

The old CI's `releasePleaseHelper` (.dagger/src/release.ts) ran a Claude Code
agent between `release-please release-pr` and `release-please github-release` to
rewrite the auto-generated per-package CHANGELOGs into a tight,
library-consumer-focused view. The agent's behavior was driven entirely by the
prompt file `.dagger/prompts/refine-release-please.md`, which was removed
together with the `.dagger` directory when CI was stripped (commit `4f11973dc`).

`scripts/release.ts` therefore **stubs out** the refinement step (see the
`TODO(todo:release-changelog-refinement)` marker) and runs only:

1. `release-please release-pr`
2. `release-please github-release`

## To resolve

- Recover the prompt from git history:
  `git show 4f11973dc^:.dagger/prompts/refine-release-please.md`
  and re-home it somewhere the script can read it (e.g.
  `scripts/prompts/refine-release-please.md`).
- Re-implement the refine step in `scripts/release.ts` between the two
  release-please invocations: run `claude -p "$(cat <prompt>)"` with
  `--output-format json --allowed-tools Bash,Read,Edit,Write,Grep,Glob
--dangerously-skip-permissions --max-turns 80 --model claude-opus-4-8`,
  authed by `CLAUDE_CODE_OAUTH_TOKEN` from the environment.
- The agent runs `git`/`gh` non-interactively and needs the same GitHub App
  git-auth env the release-please invocations use.
- Once wired and verified, delete this todo and remove the source marker in the
  same commit.
