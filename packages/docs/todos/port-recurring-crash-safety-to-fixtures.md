---
id: port-recurring-crash-safety-to-fixtures
type: todo
status: planned
board: true
verification: agent
disposition: active
---

# Port the recurring crash-safety tests into the fixture corpus

`packages/tasks-for-obsidian/src/data/sync/__tests__/recurring-crash-safety.test.ts`
holds five tests that exist **only in TypeScript**. Everything else in that
directory is a thin loader over the language-neutral corpus in
`packages/tasknotes-fixtures`, so the Rust core runs the identical stories.
These five it does not.

## How they got that way

They are not new work. They landed on `main` in
`32ffa109c fix(tasks-for-obsidian): make recurring mutations crash-safe (#2012)`
— a real data-loss fix — **after** `harness.test.ts` and
`offline-scenarios.test.ts` had been converted to fixture loaders on the
`native-macos-experience` branch.

When the branch was rebased onto `main`, the converted files replaced the
extended ones, and git reported no conflict worth flagging beyond the import
block. Five tests covering a shipped fix disappeared into a clean-looking
merge. They were caught by grepping for the test names after the rebase, not by
any gate, and restored verbatim rather than paraphrased.

⚠️ The lesson worth keeping: **converting a test file into a loader makes every
later change to it a silent-deletion risk.** A conflict in a file whose content
moved elsewhere does not look like lost coverage.

One assertion had to be adapted rather than copied: `ApiError.statusCode` is
spelled `status` on this branch after the tagged-error-kinds change. That
mismatch is what proved the restored tests were actually running.

## Remaining

- [ ] Express all five as JSON scenarios under
      `packages/tasknotes-fixtures/scenarios/`, so `tasknotes-core` checks the
      same crash-safety behaviour it now only checks on the TypeScript side.
      Two of them (`stale recurring restores return a conflict…`,
      `already-restored recurring state is idempotent`) exercise `FakeServer`
      wire semantics directly rather than the engine, so confirm the scenario
      schema can express a bare server call before converting — if it cannot,
      that limitation is the finding, and it should be recorded here rather
      than worked around.
- [ ] Delete `recurring-crash-safety.test.ts` once the corpus covers it, and
      confirm the Rust side actually runs the new scenarios (a fixture nothing
      loads is worse than a TS-only test, because it looks covered).

## Comment Log

- 2026-08-09: Created while rebasing `native-macos-experience` onto `main`.
  The tests are restored and passing; only the cross-language half is
  outstanding, which is why this is `planned` rather than blocking.
