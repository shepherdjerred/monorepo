# Local CI/Release CLI for Ad-Hoc Deploys

## Summary

- Add a local umbrella CLI, exposed as `bun run ci:local -- ...` and backed by `scripts/ci`, that can run the repo's deploy/release workflows without Buildkite.
- Keep the real Docker repositories and Helm chart names. Local runs use semver prerelease versions like `1.1.<next_patch>-local.<timestamp>`, not `*-local` image or chart names.
- Default logical targets are user-facing aliases: `tasks` maps to the homelab `tasknotes` deploy, and stageful names like `scout` expand to both stage variants by default.

## Key Changes

- Introduce a shared run context for CI and local modes: version, git SHA, branch, dry-run, release gating, metadata backend, and artifact staging directory.
- Replace direct Buildkite-only metadata/artifact assumptions with pluggable backends so existing digest handoff, cooklang artifact staging, and clauderon asset upload work in local mode.
- Centralize deploy/release catalogs in one shared module used by both pipeline generation and local orchestration:
  - app images, infra images, Helm charts, site deploy targets, tofu stacks
  - logical aliases and expansions
  - `tasks` -> `tasknotes` chart + `tasknotes-server` + `obsidian-headless`
  - stageful base names -> both stage variants unless an explicit stage is requested
- Add a new local CLI surface with domain commands:
  - `homelab deploy`
  - `image push`
  - `helm push`
  - `argocd sync`
  - `tofu apply`
  - `site deploy`
  - `cooklang release`
  - `clauderon release`
  - `tag release`
  - `npm publish`
- Add common flags across local subcommands: `--target/--all`, `--version`, `--dry-run`, and verbose logging.

## Workflow Behavior

- `homelab deploy` runs this sequence: resolve targets -> push required images -> write updated digests into `packages/homelab/src/cdk8s/src/versions.ts` -> auto-commit on the current branch -> synth cdk8s once -> package/push only affected Helm charts -> sync only affected Argo apps.
- cdk8s synthesis stays whole-app in v1 because the current app entrypoint builds all charts; targeting only affects chart publish and Argo sync.
- Argo sync rules:
  - targeted service deploys sync child apps directly
  - `apps` is only published/synced when explicitly targeted or when the workflow is intentionally doing a full homelab release
- Auto version generation parses `packages/homelab/src/cdk8s/src/versions.ts`, finds the highest local `1.1.x` patch already on disk, and emits `1.1.<max+1>-local.<timestamp>`. `--version` overrides that everywhere.
- `cooklang release` becomes end-to-end locally: version update, build, local artifact staging, push to the separate repo, create GitHub release.
- `clauderon release` becomes end-to-end locally: ensure `clauderon-v{version}` release exists, build both binaries, stage them locally, upload assets.
- `site deploy`, `tag release`, and `npm publish` become local wrappers over existing helpers. `npm publish` stays explicit and publishes the checked-out package version only; it does not try to emulate release-please.

## Test Plan

- Unit test local version generation from `versions.ts`, including override behavior and prerelease formatting.
- Unit test alias resolution for `tasks`, `scout`, and generic stageful base names.
- Unit test local metadata/artifact backend parity with current Buildkite-backed flows.
- Dry-run CLI tests for `homelab deploy`, `cooklang release`, and `clauderon release` to verify resolved actions without external mutation.
- Regression test that CI pipeline generation still emits the same targets after catalog centralization.
- Dry-run integration check that targeted homelab deploys touch only intended `versions.ts` keys and select only intended charts/apps.

## Assumptions

- Real image repos and chart names stay unchanged; `-local` is a version suffix only, not a separate Docker/Helm namespace.
- `scout` and other stageful base aliases expand to both stage deployments by default.
- `tasks` means the homelab `tasknotes` deploy.
- Auto-commit writes to the current branch only and does not auto-push.
- v1 does not implement targeted cdk8s synthesis.
