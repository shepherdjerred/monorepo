# Suppression & Ignore-Config Inventory — 2026-06-13

## Status

Complete (findings doc). Scope: first-party `packages/`, `scripts/`, `.dagger/`, `tools/`, root config. Excludes `archive/`,
`practice/`, `poc/`, `obsidian/`, generated/dist/target. `discord-video-stream` counted separately. Remediation tracked in
`plans/2026-06-13_code-quality-remediation.md` (§5/§8).

**Headline:** suppression debt is genuinely tiny and almost all justified/baselined. The valuable findings are the **gaps in
what the ratchet tracks** and a couple of **dangerous/stale exclusions**.

## Suppression directive counts (first-party)

| Directive                          | Count    | Notes                                                                                 |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `eslint-disable-next-line`         | ~9       | all with required descriptions; baselined                                             |
| `eslint-disable` (file-level)      | 1        | committed HA-schema stub (`temporal/src/generated/ha-schema.stub.ts`)                 |
| `@ts-expect-error`                 | 7        | all compile-time type tests in `home-assistant/test/typed-client.test-d.ts`           |
| `@ts-ignore` / `@ts-nocheck`       | 0        | (`@ts-nocheck` only codegen-injected into ignored generated files)                    |
| `prettier-ignore`                  | 0        |                                                                                       |
| Rust `#[allow(` (item-level)       | ~9 sites | baselined (scout desktop Tauri)                                                       |
| Rust `#![allow(` (module-level)    | 2 files  | `main.rs` (20 lints), `live_client.rs` (`dead_code`) — **NOT tracked by the ratchet** |
| Go `//nolint`                      | 1        | `terraform-provider-asuswrt/internal/client/client.go:61` (`insecure=true` opt-in)    |
| Python `# noqa`                    | 1        | `homelab/.../monitoring/scripts/nvme_metrics.py:20` (E402)                            |
| shell `# shellcheck disable`       | 2        | both intentional/explained                                                            |
| CSS / Markdown / YAML suppressions | 0        |                                                                                       |

## Gaps to fix (these matter more than the suppressions)

1. **The quality-ratchet only tracks item-level `#[allow(` — NOT module-level `#![allow(...)]`** (regex `#\[allow\(`
   doesn't match `#![allow(`). So `main.rs`'s blanket block silencing **20 clippy lints** and `live_client.rs`'s
   `#![allow(dead_code)]` are invisible. These broad blocks are exactly what should be tracked. → §5.
2. **Ratchet scope holes:** covers only `packages/` + `.dagger/`, not `scripts/`; TS/Rust only — Go/Python/shell/CSS/YAML
   suppressions are untracked. `knip.json` ignores `scripts/**` entirely. → §5.
3. **`.golangci.yml` globally excludes gosec `G104` (unhandled errors)** in production Go (`internal/client/`), not just
   tests — directly relevant to the `nvram.go` "ignored write result" finding. Re-scope to `_test.go`. → §8.
4. **tsconfig `exclude` drops test files from typecheck** in `tasks-for-obsidian`, `eslint-config`, `scout/report`, and both
   discord backends (`**/*.test.ts`) → tests aren't type-checked and can rot. → §8.
5. **Stale ignores:** better-skill-capped eslint config ignores `fetcher/**` (dir no longer exists); reconcile the
   `discord-plays-mario-kart` frontend `main.tsx` eslint-disable vs the baselined pokemon twin.

## Ignore/exclude config inventory (summary)

- **ESLint:** flat-config `ignores:` only (no `.eslintignore`). Base default ignores `generated/`, `dist/`, `build/`,
  `node_modules/`, `.astro/`, `.dagger/sdk/`, and **all `*.js/.cjs/.mjs/.md/.mdx`**. Per-package extras of note: `homelab`
  and `monarch` ignore `scripts/` (live TS); `scout` ignores `**/scripts/**`.
- **`.prettierignore`** (root): vendored emulatorjs/wasm-src/data-dragon assets, `.dagger/sdk/`, `discord-video-stream/`,
  `CHANGELOG.md`, and 6 `.astro/.mdx` files excluded for a `prettier-plugin-astro@0.14.1` parser bug (revisit on upgrade).
- **`.markdownlint-cli2.jsonc`:** disables 14 rules globally; ignores archive/generated/wasm-src/`discord-video-stream`/`practice`.
- **`knip.json`:** all categories `warn` except several `off`; ignores `scripts/**`, `.dagger/**`, `poc/**`, several packages.
- **`tsconfig` excludes:** mostly node_modules/dist; the `**/*.test.ts` excludes (above) are the notable ones.
- **`clippy.toml`:** only `cognitive-complexity-threshold = 30`. **`.golangci.yml`:** `comments` preset + test-file
  relaxations (justified) + the gosec `G104`/`G117`/`G704` excludes (G104 too broad — above).
- **`scripts/quality-ratchet.ts`** `excludeDirs`/`excludePathPatterns` and **`scripts/check-suppressions.ts`**
  `EXCLUDED_FILES`: long lists; audit each entry against an existing path + reason, delete stale ones.

## Note on CI wiring (corrected from the original audit)

The audit ran on `8f3538b1b`; re-verified on current `main`: **ESLint runs in CI per-package** (changed `packages/*` get a
`dagger call lint` step), and **`migration-guard` is already a CI gate**. The genuine CI-coverage gaps are the trees outside
`ALL_PACKAGES` (`.dagger`/`scripts` unlinted — §6) and `check-todos` (was pre-commit-only; **fixed** on
`feature/code-quality-ci-parity`).
