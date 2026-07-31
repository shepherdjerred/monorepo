---
id: log-2026-07-28-renovate-latest-updates-review
type: log
status: complete
board: false
---

# Renovate latest updates review

## Scope

Review the newest entries surfaced in Dependency Dashboard issue #481 against
the current repository, open pull requests, compatibility constraints, and
production-promotion rules.

## Evidence

- Dependency Dashboard issue #481 was live-queried on 2026-07-28 and had been
  updated at `2026-07-29T05:10:57Z`. None of the eight listed branches had an
  open pull request.
- The current dependency pins are:
  - Birmel: `ai ^6.0.180`, `@ai-sdk/openai ^3.0.63`
  - release tooling: `@openai/codex 0.145.0`
  - reviewed Unicorn policy consumers: `eslint-plugin-unicorn ^69.0.0`
  - TypeScript: predominantly `^6.0.3`
  - N64Wasm builder: `emscripten/emsdk 6.0.4`
- Stable package metadata blocks the paired AI SDK upgrade:
  `@voltagent/core 2.9.0` and `@voltagent/libsql 2.1.2` both peer on
  `ai ^6.0.0`. The coordinated VoltAgent 3 prereleases instead peer on AI SDK
  7 and provider-utils 5.
- `typescript-eslint 8.65.0` peers on TypeScript `>=4.8.4 <6.1.0`.
  TypeScript is declared by 50 package manifests, and TypeScript 7.0 does not
  expose the programmatic compiler API used by tooling such as
  typescript-eslint and Astro integrations.
- Buildkite build #6780 passed and recorded:
  - Scout digest
    `sha256:abb3c7544cb3048d09e90d499ac2d81d0a9bcb660bc902391e1f70c51ea08263`
  - Starlight Karma Bot digest
    `sha256:c474c417f6234f8c41b27cdd59eb68d39a207372b4350ea13204dd5fc7665d3f`
  - `scout-site-archived: 2.0.0-6780`
- The `2.0.0-6780` GHCR tags resolve to those exact digests. Scout prod serves
  `2.0.0-6673`; Scout beta serves `2.0.0-6887`.
- The direct SeaweedFS archive listing failed because the endpoint was
  unreachable. Buildkite's successful build state and archive metadata provide
  the independent release evidence.

## Assessment

| Update                      | Effort                | Current disposition                                                                                                                                                                                                                                                                                          |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scout prod `2.0.0-6780`     | S/M operational       | Eligible promotion candidate; immutable tag, image build/smoke, and paired site archive are proven. Promotion still needs deliberate prod review and post-deploy verification.                                                                                                                               |
| Starlight prod `2.0.0-6780` | S operational         | Eligible promotion candidate; immutable tag and successful image lane are proven. Promotion still needs runtime health verification.                                                                                                                                                                         |
| Emscripten `6.0.5`          | S                     | Ready after the configured stability window. The actual patched N64Wasm source compiles in the 6.0.5 image and the generated runtime passes the ROM-free Bun Worker smoke.                                                                                                                                   |
| `@openai/codex 0.146.0`     | S                     | Ready after the configured stability window. Version, `exec` option surface, and the three disabled release-refiner feature flags match 0.145.                                                                                                                                                               |
| `eslint-plugin-unicorn 72`  | S/M                   | Ready. The explicit 137-rule policy remains valid; a temporary v72 installation passes the package typecheck and all 245 ESLint-config tests. Run affected repository lint in the implementation PR.                                                                                                         |
| `ai 7` + `@ai-sdk/openai 4` | M/L, prerelease-gated | Possible only as a coordinated migration to VoltAgent 3 prereleases. The stable stack rejects the provider-v4 model type; the prerelease stack typechecks and constructs the agent, memory, subagent, and provider options. Prefer waiting for VoltAgent 3 stable unless prerelease adoption is intentional. |
| TypeScript 7                | M/L staged migration  | Possible now as a dual toolchain, not as Renovate's direct replacement. Keep TypeScript 6 for the API/peer contract and install TypeScript 7 as `@typescript/native`; pilot and then roll the pattern through all 50 declaring manifests. The official compatibility package is currently broken under Bun.  |

## Focused compatibility investigation

### Unicorn 72

- The only documented v72 breaking change renames an option on
  `prefer-minimal-ternary`; that rule and option are not in the repository's
  reviewed policy.
- All 137 reviewed rule names exist in v72. The plugin has 341 total rules, but
  the explicit policy prevents its newly recommended rules from being enabled
  automatically.
- A temporary copy of `@shepherdjerred/eslint-config` using v72 passed
  `tsc --noEmit` and all 245 tests.
- Source:
  [eslint-plugin-unicorn v72 release](https://github.com/sindresorhus/eslint-plugin-unicorn/releases/tag/v72.0.0).

### Emscripten 6.0.5

- Upstream's only listed change from 6.0.4 is a revert for emsdk paths that
  contain spaces.
- The multi-architecture image resolves to
  `sha256:76a44fff907397784decc435115d07fcb9587a4f1504977f39f3745e538e3a1e`.
- The repository's pristine N64Wasm source plus all four patches compiled in
  that exact image. The resulting `n64wasm.js` and `n64wasm.wasm` then passed
  `smoke-wasm-host.ts` under Bun without a ROM.
- `README.md` and `wasm-src/PATCHES.md` still describe obsolete Emscripten 2.x
  pins even though the executable configuration is 6.0.4; the upgrade PR
  should correct those docs to 6.0.5.
- Source:
  [Emscripten 6.0.5 release](https://github.com/emscripten-core/emscripten/releases/tag/6.0.5).

### Codex 0.146

- `bunx @openai/codex@0.146.0` reports `codex-cli 0.146.0`.
- The 0.145 and 0.146 `codex exec --help` option surfaces are identical for
  every flag used by `scripts/lib/release-refiner.ts`.
- `apps`, `plugins`, and `multi_agent` remain stable feature names, so the
  release refiner's explicit disable list still parses.
- The release contains substantial product work but does not report a breaking
  noninteractive CLI change.
- Source:
  [Codex 0.146 release](https://github.com/openai/codex/releases/tag/rust-v0.146.0).

### AI SDK 7 and OpenAI provider 4

- The direct dashboard updates cannot be split within Birmel's single
  AI-SDK/provider namespace. In an isolated TypeScript check,
  `@ai-sdk/openai 4` produces `LanguageModelV4`, which both AI SDK 6 and
  VoltAgent 2.9 reject.
- A coordinated isolated stack using `ai 7.0.41`,
  `@ai-sdk/openai 4.0.23`, `@voltagent/core 3.0.0-next.1`,
  `@voltagent/libsql 3.0.0-next.0`, and
  `@voltagent/logger 3.0.0-next.0` passed strict typechecking after adding the
  missing direct `@types/json-schema` development dependency.
- That stack also constructed the same agent, memory, embedding, vector
  adapter, subagent, and Responses provider-options shapes Birmel uses without
  making an API request. Birmel's other imported VoltAgent surfaces
  (`AgentHooks`, `ToolSchema`, `createTool`, `AgentRegistry`, and
  `VoltAgentObservability`) also typecheck.
- AI SDK 7 changes the OpenAI Responses behavior: a non-`none`
  `reasoningEffort` now defaults `reasoningSummary` to `detailed`. Birmel should
  set `reasoningSummary: null` during migration to preserve its current
  no-summary payload behavior while retaining encrypted-reasoning replay,
  unless summaries are intentionally adopted.
- This proves feasibility, not production readiness: the required VoltAgent 3
  family is still tagged `next`.
- Source:
  [AI SDK 7 migration guide](https://github.com/vercel/ai/blob/main/content/docs/08-migration-guides/23-migration-guide-7-0.mdx).

### TypeScript 7

- TypeScript 7.0 is the production native compiler, but it intentionally ships
  without a programmatic API. Microsoft recommends running it alongside
  TypeScript 6 until the new API arrives in TypeScript 7.1.
- The direct TypeScript 7 compiler passed representative clean configurations
  for root scripts, ESLint config, homelab, Tasks for Obsidian, Astro
  OpenGraph Images, and code-review. Where the current checkout has baseline
  TypeScript 6 diagnostics, TypeScript 7 produced the identical diagnostic set.
- The officially recommended alias
  `typescript: npm:@typescript/typescript6` is currently unusable with Bun
  1.3.14: Bun recursively resolves the compatibility package's nested alias
  back to itself, leaving the TypeScript API empty. This is tracked in open Bun
  issue #33834.
- A workable Bun-specific dual installation was verified:
  `typescript: 6.0.3` supplies the API and satisfies typescript-eslint, while
  `@typescript/native: npm:typescript@7.0.2` supplies `tsc`. In the isolated
  test, `tsc` reported 7.0.2, importing `typescript` reported 6.0.3 with
  `createProgram`, and typescript-eslint loaded successfully.
- That workaround needs a deliberate monorepo pilot because 50 manifests
  declare TypeScript and the isolated linker gives each workspace its own
  binary boundary.
- Sources:
  [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  and [Bun issue #33834](https://github.com/oven-sh/bun/issues/33834).

## Renovate configuration finding

The two prod promotions are incorrectly inheriting the repository-wide
30-day `minimumReleaseAge`:

- The versions annotations capture `depName` as
  `shepherdjerred/<image>/prod`.
- They override `packageName` to the real GHCR package
  `shepherdjerred/<image>`.
- The no-delay package rule uses `matchPackageNames` with the `/prod` stage
  keys.

`matchPackageNames` matches `packageName`; `matchDepNames` matches `depName`.
The observed `Pending Status Checks` placement is consistent with this rule not
matching. Change that rule to target the stage `depName` values so future prod
promotion PRs follow the documented no-delay, no-automerge policy.

## Recommended order

1. Take Unicorn 72 as the next code-quality update.
2. Take Emscripten 6.0.5 and Codex 0.146 as separate small PRs after their
   configured stability windows.
3. Keep AI SDK 7 and OpenAI provider 4 paired. Either wait for VoltAgent 3
   stable or explicitly authorize a prerelease migration worktree.
4. Replace the direct TypeScript 7 Renovate proposal with a dual-toolchain
   pilot. If the pilot passes Buildkite, roll it mechanically through the
   remaining TypeScript workspaces.

## Session Log — 2026-07-28

### Done

- Reconciled the dashboard entries against current `main`, package metadata,
  release notes, image tags, and Buildkite evidence.
- Proved Unicorn 72 with the ESLint-config typecheck and all 245 tests.
- Proved Emscripten 6.0.5 with a real N64Wasm compile and ROM-free Worker smoke.
- Proved the Codex 0.146 release-refiner CLI and feature-flag contract.
- Demonstrated both the stable AI SDK/OpenAI incompatibility and a compiling,
  constructible VoltAgent 3 prerelease migration stack.
- Demonstrated a working TypeScript 7 plus TypeScript 6 API arrangement and
  reproduced the current Bun blocker in Microsoft's recommended package.

### Remaining

- No dependency manifests were changed. The immediate implementation sequence
  is Unicorn, Emscripten, and Codex; the AI SDK and TypeScript paths require
  explicit migration PRs rather than accepting the direct Renovate updates.

### Caveats

- The AI SDK proof covers Birmel's current framework integration surfaces but
  not a real OpenAI API request or the complete application test suite.
- The TypeScript proof is representative rather than the exhaustive 50-manifest
  Turbo graph; the dual-toolchain bin selection must be verified under the
  repository's isolated linker in its implementation PR.
- Dependency Dashboard and prerelease package state can change on the next
  Renovate or package publication run.
