# PR #1281 — scout-for-lol frozen-lockfile failure (bun 1.3.14 file: dep bug)

## Status

Complete (fix pushed; CI re-running)

## Context

PR #1281 (`feature/llm-models-catalog`) centralizes LLM model definitions into
`@shepherdjerred/llm-models` and migrates consumers. Two CI checks were red:

- `shield-quality-bundle-15-checks` → sub-check `scout-test-template` failed with
  `error: lockfile had changes, but lockfile is frozen`.
- `mag-greptile-review` → timed out after 1200s waiting for the Greptile review
  check to complete on the merge commit (expected to clear on a fresh push).

## Root cause (the real one)

The PR added `@shepherdjerred/llm-models` as a `file:` dependency **inside scout's
shared `data` package**. `data` is consumed via `file:../data` by **6 sibling
packages** (app/backend/desktop/frontend/report/ui).

bun 1.3.14's incremental install **fails to propagate a new transitive `file:`
dep through the file: dependency graph**. It writes a stable fixed-point lockfile
that its own `--frozen-lockfile` check then rejects (`updated N dependencies`
where N == each consumer's count of file: deps that transitively include `data`).
Reproduced identically locally and in CI (both bun 1.3.14). `bun install`,
`--force`, `--lockfile-only`, and repeated passes all converge to the same
frozen-dirty lockfile.

### Why the obvious fixes don't work

- **From-scratch regen** (`rm bun.lock && bun install`) is the only bun-clean
  output, but it bumps ~98 deps (incl. a `commander` major) **and** bumps
  `twisted` 1.73.0 → 1.81.0. twisted 1.81 removed `dist/constants/champions.js`
  (bundled into `index.js`, no `exports` map), which **breaks** `champion.ts`'s
  deep import `twisted/dist/constants/champions.js` — a hard build break, not
  just losing the ZAAHEN champion patch.
- **From-scratch + pin twisted 1.73 (override)** re-triggers the frozen bug.
- **From-scratch + rewrite the patch for twisted 1.81** is _also_ frozen-dirty
  (a patched dep doesn't propagate through the file: graph in the hoisted form).
- So with llm-models in `data`, (frozen-clean AND ZAAHEN AND working build) is
  impossible under bun 1.3.14.

## Fix

Declare `@shepherdjerred/llm-models` at the **scout workspace root**
(`packages/scout-for-lol/package.json`) instead of inside `data`, alongside the
other shared deps (openai/twisted/zod). This sidesteps the per-sibling
multiplication entirely:

- `data/review/models.ts` resolves the catalog via workspace hoisting.
- `twisted` stays pinned at **1.73.0** with its ZAAHEN patch untouched.
- **No other dependency versions change** (verified: zero version drift vs the
  committed lockfile; only the llm-models relocation + dedup of the 6
  per-consumer `data` entries).

Tradeoff: `data` imports the catalog but declares it at the root — a mild hygiene
compromise contained within the closed scout workspace. knip does **not** flag it
(it resolves the data→root usage). Chosen by the owner over from-scratch.

### Files changed

- `packages/scout-for-lol/package.json` — `+@shepherdjerred/llm-models` (root deps)
- `packages/scout-for-lol/packages/data/package.json` — `-@shepherdjerred/llm-models`
- `packages/scout-for-lol/bun.lock` — relocate to root + dedup (no version drift)

Commit `71fd97407`.

## Verification (local)

- `bun install --frozen-lockfile` (scout root) — **passes**, stable across reinstall.
- `bun run check:test-template` (the failing CI sub-check) — exit 0.
- Full scout `bun run typecheck` — exit 0; `bun run lint` — exit 0.
- `data` tests — 345 pass / 0 fail.
- twisted resolves to 1.73.0; `twisted@1.73.0.patch` retained.
- knip: no new findings (llm-models not flagged).

Note: a clean backend typecheck requires the full `bun run generate` (it runs
`brand-types` after `prisma generate`); a bare `bunx prisma generate` leaves the
branded prisma types unpopulated and produces ~100 false errors.

## Session Log — 2026-06-20

### Done

- Diagnosed the `scout-test-template` frozen-lockfile failure to a bun 1.3.14
  file:-dep propagation bug (not a stale/merge lockfile).
- Fixed by moving llm-models to the scout workspace root (commit `71fd97407`,
  pushed to `feature/llm-models-catalog`); verified frozen + typecheck + lint +
  data tests + check:test-template locally.

### Remaining

- Watch Buildkite build #4555: confirm `scout-test-template` and
  `mag-greptile-review` go green (greptile gate previously timed out on the merge
  commit; a fresh push should let it complete).
- One unresolved PR review thread is the owner's own note ("this is crazy" on
  `packages/monarch/src/lib/usage.ts:23`) — authored by `shepherdjerred`, not
  `greptile-apps`, so it does not block the greptile gate. Left as-is.
- PR description still says scout declares the catalog in `data`; update it to say
  "scout root" (owner's call).

### Caveats

- The bun bug affects any future `file:` dep added to a scout sub-package shared
  by multiple siblings. Prefer the scout root for shared deps, or a bun version
  that fixes the incremental propagation.
- Do not regenerate scout's `bun.lock` from scratch — it bumps twisted to 1.81
  (breaks `champion.ts`'s deep import) and ~97 other in-range deps.
