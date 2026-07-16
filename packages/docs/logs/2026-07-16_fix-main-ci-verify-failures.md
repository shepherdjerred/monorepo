# Fix main CI: four verify failures (build 5611)

## Status

In Progress

## Context

First real run of the new static Buildkite pipeline on main (build
[5611](https://buildkite.com/sjerred/monorepo/builds/5611), commit
`4f08817be`) failed in the `:turborepo: verify` step, blocking every
main-only deploy step. Build 5607 before it failed at pipeline upload
itself (fixed by #1517), so 5611 was the first build to exercise the
full verify surface on main.

## Failures and fixes

| Task                               | Cause                                                                                                                                                             | Fix                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `//#markdownlint`                  | `packages/docs/plans/2026-07-12_turbo-buildout-derisk.md` had MD022/MD032 violations (Session Log appended raw)                                                   | `markdownlint-cli2 --fix`                                                 |
| `//#prettier`                      | Three docs files committed unformatted (same plan file, its sibling replatform plan, and a 07-15 log)                                                             | `prettier --write`                                                        |
| `tasks-for-obsidian#test:contract` | Calendar test hardcoded `due: "2026-07-15"`; the server's default calendar window is `[today, today+30d]`, so the test began failing when the date rolled past    | Use `localTodayYmd()` for the due date                                    |
| `@scout-for-lol/backend#test`      | "account limit is enforced per-server independently" inserts 100 players/accounts one `create` (= one commit/fsync) each; 5475ms vs 5s default timeout on CI pods | Batch both test helpers' inserts into one `$transaction` (~240ms locally) |

## Notes

- The docs-formatting failures happened because those files were committed
  from sessions that didn't run the formatters; the pre-commit hook formats
  staged files, so these were likely committed with hooks unarmed or bypassed.
- trivy and semgrep also failed on 5611 but are `soft_fail` — intentionally
  ignored per the CI design.
- PR: [#1525](https://github.com/shepherdjerred/monorepo/pull/1525)
