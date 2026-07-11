# Scout Temporal workflow failures — diagnosis

## Status

Complete (diagnosis only — no fix applied this session)

## Question

Why did the latest Scout Temporal workflows fail?

## How investigated

- `temporal` CLI couldn't reach the server directly, and `kubectl port-forward svc/temporal-temporal-server-service 7233` fails because the server binds its pod IP, not pod-localhost (`connection refused` inside the pod netns).
- Worked instead via the Temporal UI HTTP API on Tailscale: `https://temporal-ui.tailnet-1a49.ts.net/api/v1/namespaces/default/workflows?query=ExecutionStatus='Failed'` and `.../workflows/<id>/history`.

## Findings

Two distinct, **recurring** failures (each reproduced identically the prior week):

### 1. `scout-data-dragon-weekly-refresh` — failed 2026-07-11 13:00 UTC (and 2026-07-04, 2026-06-20)

All 3,496 assets download fine. The failure is in the snapshot-update step of
`packages/scout-for-lol/packages/data/scripts/update-data-dragon.ts` (~line 1202):
`bun test --update-snapshots src/html/arena/realdata.integration.test.ts` dies with

```
Cannot find module '@shepherdjerred/llm-models' from .../packages/data/src/review/models.ts
```

The activity's temp-clone "Refreshing workspace install" does a plain install that never builds the
`file:` producer `@shepherdjerred/llm-models` — the classic setup.ts-vs-bun-install gap called out in
root CLAUDE.md. Fix direction: make the data-dragon activity (worker temp clone) build/copy llm-models
before running snapshot updates, or drop the llm-models import from the data package's test path.

Side observation in the same run: `⚠ Twisted does not recognize 2 champion(s): Locke (id 805), Zaahen (id 904). Bump twisted to pick them up.` (warning only, not the failure).

### 2. `scout-season-refresh-weekly` — failed 2026-07-06 14:00 UTC (and 2026-06-29, 2026-06-15)

The activity's `git commit` in the temp clone triggers **lefthook pre-commit**; the
`scout-for-lol-typecheck` hook runs `db:generate`, whose `bunx prettier --write generated/` step fails:

```
Cannot find package 'prettier-plugin-astro' imported from .../packages/scout-for-lol/packages/backend/noop.js
```

Root prettier config loads `prettier-plugin-astro`, which isn't installed in the scoped temp-clone
install on the worker. Fix direction: commit with `LEFTHOOK=0` / `--no-verify` in the deterministic
PR-creating activities (CI re-validates on the PR anyway), or install the full root devDependencies
in the temp clone.

Both `retryState: RETRY_STATE_MAXIMUM_ATTEMPTS_REACHED` — retries can't help; these are deterministic environment gaps in the worker's temp clone, and each will fail again next week until fixed.

## Session Log — 2026-07-11

### Done

- Diagnosed both failing Scout Temporal workflows from execution histories (via Temporal UI HTTP API over Tailscale).

### Remaining

- Fix the two root causes (llm-models build in data-dragon temp clone; lefthook/prettier-plugin-astro in season-refresh commit path). Not requested this session.

### Caveats

- `kubectl port-forward` to the Temporal frontend does not work (server binds pod IP); use the UI HTTP API or in-cluster access.

## Session Log — 2026-07-11 (fix session)

### Done

- All three root causes fixed and proven locally; see
  [2026-07-11_fix-temporal-weekly-refreshes](../plans/2026-07-11_fix-temporal-weekly-refreshes.md)
  for the fixes, the `temporal-schedule-rehearsal` CI step, and the full local
  verification record.

### Remaining

- Nothing for the diagnosis itself.

### Caveats

- Prediction correction: the fix session's local reproduction confirmed the
  hook chain (root install `prepare` → `lefthook install`), and the fix chosen
  was "no hooks in bot clones" via `--ignore-scripts` (per user decision), not
  `LEFTHOOK=0`/`--no-verify` as this log's "fix direction" first suggested.
