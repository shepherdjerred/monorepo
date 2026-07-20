---
id: reference-completed-2026-06-07-mariokart-react-version-skew
type: reference
status: complete
board: false
---

# mariokart.sjer.red — React "Incompatible React versions" skew

## Context

`mariokart.sjer.red` (web controller UI for `packages/discord-plays-mario-kart`) crashed on load
with a blank page and a React runtime error.

**Root cause:** `packages/discord-plays-mario-kart/packages/frontend/package.json` declared the two
packages that must move in lockstep with mismatched specifier styles — `react: "19.2.6"` (exact) and
`react-dom: "^19.1.0"` (range). `^19.1.0` resolves to the newest 19.x (19.2.7) while the exact pin
freezes react at 19.2.6. `react-dom@19.2.7` ships a module-load guard (in both
`cjs/react-dom-client.development.js` and `.production.js`):

```js
var isomorphicReactPackageVersion = React.version;
if ("19.2.7" !== isomorphicReactPackageVersion)
  throw Error(
    'Incompatible React versions: The "react" and "react-dom" packages must have the exact same version. ...',
  );
```

React 19 requires react and react-dom to be the exact same version. The guard throws the instant
`react-dom/client` is imported in `main.tsx` — before render, above the Sentry `ErrorBoundary` — so
the whole bundle fails to boot. The skew was baked in at the _first_ `bun install`: the caret grabbed
19.2.7, the exact pin grabbed 19.2.6. `react-dom@19.2.7` also peer-requires `react: ^19.2.7`, but Bun
does not fail installs on unmet peer deps, so nothing surfaced it.

### Why it passed CI

`tsc --noEmit` (types identical across 19.2.x), `vite build` (never evaluates the guard IIFE),
eslint (unrelated), and `test` (the frontend's script is literally `"test": "true"`) all pass. The
package's Dagger smoke test boots the **backend** and asserts a Discord auth failure — it never
serves or loads the SPA. No CI gate runs the rendered page, so a runtime-only throw is invisible.

### Audit — same class elsewhere

The check (which reads resolved versions, not just specifier styles) caught **6** packages — one more
than the manual audit, which wrongly cleared `better-skill-capped`:

| Package                                               | before                                                  | after                    |
| ----------------------------------------------------- | ------------------------------------------------------- | ------------------------ |
| `packages/discord-plays-mario-kart/packages/frontend` | react 19.2.6 / react-dom 19.2.7                         | both 19.2.7              |
| `packages/discord-plays-pokemon/packages/frontend`    | react 19.2.6 / react-dom 19.2.7                         | both 19.2.7              |
| `packages/better-skill-capped`                        | react 19.2.6 / react-dom 19.2.5                         | both 19.2.7              |
| `practice/a2ui-poc/frontend`                          | react 19.2.6 / react-dom 19.2.3                         | both 19.2.7              |
| `practice/claude-web/frontend`                        | react 19.2.6 / react-dom **18.3.1**                     | both 19.2.7              |
| `poc/sentinel/web`                                    | mixed specifier styles (lockfile already 19.2.4/19.2.4) | both pinned exact 19.2.4 |

`tasks-for-obsidian` carries a _transitive_ react-dom (React Native, never rendered) — correctly
**not** flagged, because the check only enforces the rule where a workspace declares both halves
directly.

## What shipped

### A. Version alignment

`react` and `react-dom` pinned to the **same exact version** in all 6 packages (the
`scout-for-lol/packages/{app,frontend,desktop}` convention), `@types/react` / `@types/react-dom`
aligned to `^19.2.x`, and each directory's own `bun.lock` regenerated with `bun install`. Target
19.2.7 (current `latest`) everywhere except `poc/sentinel/web`, which can't `bun install` standalone
(pre-existing `@shepherdjerred/eslint-config: "workspace:*"` that doesn't resolve outside a
workspace) — its package.json was aligned to its already-consistent committed lockfile (19.2.4).

### B. Static check — `scripts/check-react-version-sync.ts`

Scans every `bun.lock` (excludes `node_modules`, `archive`). Parses the JSONC lockfile (a small
string-state-machine strips trailing commas/comments — `bun.lock` is not strict JSON). For each
`LOCKSTEP_PAIR` (`react`/`react-dom` exact; `@types/react`/`@types/react-dom` major) it reads the
`workspaces` section to find workspaces declaring **both** halves directly, then:

1. flags mismatched specifier styles (exact vs range) — the upstream cause;
2. asserts the resolved versions in `packages` are identical (exact) / same-major (`@types`).

Wired as a blocking gate:

- `lefthook.yml` — Tier-2 `react-version-sync` job (glob `**/package.json`, `**/bun.lock`).
- `.dagger/src/quality.ts` `reactVersionSyncHelper` + `.dagger/src/index.ts` `@func() reactVersionSync`.
- `scripts/ci/src/steps/quality.ts` `reactVersionSyncStep()` added to `blockingGates` in
  `scripts/ci/src/pipeline-builder.ts` (hard-fail). Renders as
  `dagger ... call react-version-sync --source <ref>`.

Note: `practice/` and `archive/` are in Dagger's `SOURCE_EXCLUDES`, so CI validates `packages/` +
`poc/`; pre-commit (working tree) additionally covers `practice/`.

### C. Renovate grouping

`renovate.json` packageRule grouping `react` + `react-dom` + `@types/react` + `@types/react-dom`
(`groupName: "React"`) so they always bump together in one PR to one resolved version — drift can't
be reintroduced on a future bump. (Grouping is necessary but not sufficient; the static check is the
backstop, and identical specifier styles are what guarantee identical resolved versions.)

## Verification

- `bun scripts/check-react-version-sync.ts` → green (37 lockfiles); fails loudly on a reverted pin
  (demonstrated on `better-skill-capped` before the fix).
- All 6 lockfiles: react == react-dom (4× 19.2.7, sentinel 19.2.4).
- `bun run --filter '@discord-plays-mario-kart/frontend' build` → success; rebuilt bundle contains
  only `19.2.7` (no second react version), so the guard passes instead of throwing.
- `scripts/ci` typechecks; pipeline generator emits the `react-version-sync` gate.
- `renovate-config-validator renovate.json` → "Config validated successfully".

## Session Log — 2026-06-07

### Done

- Root-caused the live crash to react/react-dom skew enforced by react-dom@19.2.7's module-load guard
  (verified against published tarballs and the rebuilt bundle).
- Fixed 6 packages (5 from audit + `better-skill-capped`, found by the new check) and regenerated
  their lockfiles.
- Added `scripts/check-react-version-sync.ts` and wired it into lefthook + Dagger + Buildkite as a
  blocking gate.
- Added the Renovate "React" group.

### Remaining

- None for this scope. (Optional future hardening: a headless-browser smoke test would catch
  _non-version_ runtime boot failures too — explicitly deferred this round.)

### Caveats

- `poc/sentinel/web` cannot `bun install` standalone (pre-existing `workspace:*` eslint-config dep);
  its package.json was aligned to its committed lockfile (19.2.4) rather than bumped to 19.2.7.
- Each affected dir is its own install root with its own `bun.lock`.
- `lodash@4.18.1` (pinned in the Discord-plays apps) is a real 2026-04-01 release with an unchanged
  module format — investigated and ruled out as a cause.
