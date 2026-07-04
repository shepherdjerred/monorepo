---
id: bun-isolated-linker-eexist
status: active
origin: packages/docs/logs/2026-07-04_ci-eexist-isolated-linker.md
source_marker: true
---

# Remove hoisted-linker pins once bun's isolated installer EEXIST race is fixed

## What

`bunfig.toml` in `packages/discord-plays-pokemon`, `packages/discord-plays-mario-kart`,
and `packages/scout-for-lol` pins `linker = "hoisted"` (marker comments carry
`TODO(todo:bun-isolated-linker-eexist)`).

## Why

With `linker = "auto"`, bun ≥1.3 silently selects the isolated linker for any
workspace whose `bun.lock` has `configVersion: 1`
(`install_with_manager.rs`: `NodeLinker::Auto` → `Isolated` when
`workspace_paths.len() > 0`). Bun's isolated installer has an unfixed EEXIST
race when several workspace members reference the same `file:` dep:

- <https://github.com/oven-sh/bun/issues/12917>
- <https://github.com/oven-sh/bun/issues/20142>

After the 2026-07-03 Dagger engine disk-full outage wiped the layer cache,
every CI install re-ran from scratch and this race made nearly every build red
(`EEXIST: File exists: failed to link package: @shepherdjerred/eslint-config@../eslint-config (link)`).

## Exit criteria

- A bun release fixes the isolated-install EEXIST race (watch the issues above).
- Bump `BUN_IMAGE` in `.dagger/src/constants.ts` to that release.
- Remove the three `[install] linker = "hoisted"` pins + marker comments, run a
  fresh-worktree `bun run scripts/setup.ts` to confirm isolated installs work,
  and delete this doc in the same commit.
- Note: `packages/scout-for-lol/packages/data` imports
  `@shepherdjerred/llm-models` which is declared only at the scout root
  (phantom dep, works via hoisting). Isolated mode will fail on it — move the
  dep into `packages/data/package.json` before un-pinning.
