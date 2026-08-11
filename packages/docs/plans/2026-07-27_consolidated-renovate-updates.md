---
id: consolidated-renovate-updates-2026-07-27
type: plan
status: in-progress
board: false
---

# Consolidated Renovate Updates

## Goal

Create one reviewable pull request that clears the low-risk dependency backlog,
updates every current Helm/container/infrastructure pin requested by the user,
and includes language/toolchain updates whose repository-specific assessment is
easy or medium-easy.

## Inclusion Rules

1. Include every dashboard item sourced from Docker/container images, Helm
   charts, infrastructure tool pins, or deployed version catalogs. This includes
   the difficult Emscripten 6, Docker 29, Ubuntu 26, and stateful chart updates
   because the user explicitly requested all infrastructure updates in one PR.
2. Include XS, S, and tractable M updates in the Bun/Node, Go, Rust, and general
   developer-tooling ecosystems.
3. Include coherent patch compatibility sets together: React Native `0.86.2`
   with its three matching configuration packages, and all packages in grouped
   Renovate updates.
4. Preserve generated artifacts and integrity pins: regenerate Helm value types,
   refresh hashes/digests, and update the single root `bun.lock`.

## Explicit Exclusions

Leave these dedicated migrations for later because the repository assessment
classified them as L/XL or ecosystem-blocked and they are not Helm/container
updates:

- Babel 8
- Astro 7
- AI SDK 7 and `@ai-sdk/openai` 4
- `node-av` 6
- React Native Gesture Handler 3
- Satori `0.29`
- OpenTelemetry JS grouped update
- Temporal TypeScript `1.21`
- Chevrotain 13
- tslog 5
- TypeScript 7
- Vite 8 for `sjer.red` and `stocks-sjer-red`: the attempted update exposed an
  Astro/Tailwind resolver incompatibility, so both sites remain on Vite 7.
- deprecated dependency replacements
- `fast-uri` 4, `js-yaml` 5, and `linkify-it` 6: each is a root override
  that would force a version outside direct consumers' declared ranges. Keep
  `fast-uri` on the latest 3.x patch instead.
- `eslint-plugin-unicorn` 69: the immediately preceding batch attempted Unicorn
  67 and produced more than 700 repository lint failures, so 69 is not
  medium-easy.
- React Native Worklets `0.11`: React Native Reanimated currently declares a
  `0.10.x` peer requirement. Keep Worklets on 0.10 while applying the React
  Native `0.86.2` patch set.
- Kubernetes `1.36.3`, Talos `1.13.7`, and the Talos installer images: these
  require coordinated hardware/node changes and remain in their separate
  Renovate PRs.

## Implementation Phases

1. Create an isolated git-spice worktree from current `origin/main`, move this
   plan and the completed assessment log into it, and perform the required
   toolchain/install/generate setup.
2. Apply manifest and toolchain updates, then refresh the root lockfile without
   accepting unrelated dependency churn.
3. Update all image/chart/version pins and regenerate every affected committed
   Helm type.
4. Fix forward for compile, lint, test, render, schema, and image-build failures.
5. Run focused verification throughout, followed by `bun run verify -- --affected`
   and the relevant container/Helm validation surfaces.
6. Append the final session summary, commit only intended files, push with
   git-spice, open one draft PR, add any required evidence, and promote it only
   when verification is complete.

## Implementation Results

- Updated the tractable JavaScript/TypeScript, Go, Rust, and repository-tooling
  dependencies, including React Native `0.86.2`, Prisma `7.9.1`, Monaco
  `0.56`, Knip `6.22.0`, Turbo `2.10.7`, Go `1.26.5`, and Rust `1.96.0`.
- Updated the requested Helm charts, deployed container pins, Docker bases, and
  infrastructure tools. Regenerated the Argo CD, kube-prometheus-stack, and
  SeaweedFS Helm types.
- Fixed forward for the resulting compatibility changes: Emscripten 6 pointer
  types and runtime settings, Monaco's public worker export, Knip 6 import
  resolution, a portable pinned mise installer in the CI image, and realistic
  Scout image-render test timeouts under the full parallel verification load.
- Reconciled the newly merged Buildkite UV and Trivy cache PVCs with the
  explicit backup policy as rebuildable, backup-disabled cache data.
- Kept Kubernetes, Talos, and Talos installer pins unchanged for the separate
  hardware-coordinated rollout.
- Verified all 195 affected repository tasks plus frozen installation, Helm 4
  generation/linting, Compose rendering, and the custom Bindery, Shelfbridge,
  Redlib, Mario Kart WASM, and CI base-image builds.

## Acceptance Criteria

- Every included dashboard target is represented exactly once in the final diff.
- Excluded majors remain unchanged and are named in the PR description.
- The root lockfile is frozen-install clean.
- Changed chart generator inputs have matching committed generated types.
- Affected verification and repository checks pass without suppressions,
  exclusions, skipped tests, or weakened assertions.
- The PR clearly distinguishes source-level verification from production
  rollouts that occur through GitOps reconciliation after merge.
