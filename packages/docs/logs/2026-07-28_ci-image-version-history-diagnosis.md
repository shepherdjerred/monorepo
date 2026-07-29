---
id: log-ci-image-version-history-diagnosis
type: log
status: complete
board: false
---

# CI Image Version History Diagnosis

## Question

Why did a failing `main` CI build appear to become healthy only after an
automated version update for images built by the failing build?

## Finding

The image build and the GitOps deployment were not atomic.

PR #1749 changed the MCP gateway configuration from the npm-launched
`@modelcontextprotocol/server-github` server to a baked-in
`github-mcp-server` binary. It changed both the image Dockerfile and the
runtime configuration, but `versions.ts` still pinned the deployed MCP gateway
to image `2.0.0-6529`, which did not contain that binary.

Buildkite #6690 then:

1. passed verification;
2. built, smoked, and pushed the new MCP gateway image at digest
   `sha256:719ad2ddcf05af01be975f984cb2ef8a3139302724e6d2cb01111cb50b348aa9`;
3. started version commit-back as soon as the image job passed;
4. published and synchronized the Helm charts synthesized from the original
   commit, where the new command still referenced the old `2.0.0-6529` image;
5. timed out after five minutes because the Argo CD tree remained degraded,
   including `mcp-gateway`.

The version commit-back job depends only on `images`, not on `argocd-sync`.
It therefore finished and opened auto-merge PR #1754 before the parallel Argo
job reported the overall build failure.

Buildkite #6694 ran after PR #1754 changed the MCP gateway pin from
`2.0.0-6529` to the already-pushed `2.0.0-6690` digest. Its Argo tree moved
from `Degraded` to `Progressing`, then became `Healthy` after 120 seconds.
The version update did not repair a failed image build; it completed the
deployment of the compatible image/configuration pair.

## Timeline

| Build | Result   | Relevant event                                                                                   |
| ----- | -------- | ------------------------------------------------------------------------------------------------ |
| #6673 | Passed   | Last green baseline used by main change selection.                                               |
| #6679 | Canceled | PR #1749 had introduced the MCP image/configuration change.                                      |
| #6681 | Failed   | Image publication was interrupted by the BuildKit rollout race.                                  |
| #6690 | Failed   | Images passed; Argo timed out with `mcp-gateway` degraded while the generated pin PR was opened. |
| #6694 | Passed   | The `2.0.0-6690` MCP image pin deployed; the Argo tree became healthy.                           |

## Pipeline implication

The history is internally consistent, but it exposes an ordering defect:
same-commit configuration can require an image that the deployment chart
cannot reference until a later generated commit. A robust fix must make the
image digest and its dependent configuration deploy atomically, or defer the
GitOps sync until the commit-back pin is present.

## Target selection invariant

The last-green selector behaved as intended:

- Buildkite #6690 used successful Buildkite #6673
  (`24e5a5ebe4302e6dc99efc1c3706e7541d9b33dc`) as its changed base.
- Buildkite #6694 still used #6673 as its changed base.
- Both builds selected the same accumulated image target set, including the
  aggregate `infra` target.
- Buildkite #6694 rebuilt and smoked `mcp-gateway`; its log includes the
  `github-mcp-server --version` smoke command.

CI evaluates the final snapshot at `now`, not every intermediate red snapshot.
The #6694 snapshot was the superset of accumulated work plus the generated
image-pin fix, so the same selected targets could legitimately change from red
to green.

## Validated CI Gap Audit

### Fanout follow-up scope

At the user's request, continue the read-only audit with independent subreviews
of image correctness, Helm/GitOps promotion, and release-state handling. Accept
only findings reproduced against the current tree or live read-only evidence.

### Validation method

Every earlier claim was rechecked against the current source, Buildkite job
logs and artifacts, GitHub PR state, and focused unit tests. The audit
distinguishes four different events that are easy to conflate:

1. a lane is selected;
2. a build or synthesis command runs;
3. an artifact is pushed or released;
4. a deployed version or digest pin changes.

The last-green selector itself is sound. `prepare-ci-changed-base.ts` searches
the latest 20 passed main builds, excludes the current head, validates the base
as an ancestor, and records it in `ci-changed-base`. `ci-changed.ts` compares
the final snapshots at that base and `HEAD`. Buildkite #6690 and #6694 both used
Buildkite #6673, so #6694 did rerun the accumulated work across the red interval.

### Claim-by-claim verdict

| Earlier claim                                | Verdict                                                   | Validation                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Image/config deployment is non-atomic        | **Confirmed P1**                                          | `verify` synthesizes manifests before `images`; `helm-push` consumes those pre-image artifacts; `version-commit-back` starts after `images` only. In #6690, images passed at 07:57:42, Helm and commit-back both began at 07:57:46, and Argo failed later. The deployed chart paired new MCP configuration with the old image. |
| A later green build can discard pending pins | **Confirmed P1 and observed**                             | `update-versions.ts` recreates the shared pending branch from `origin/main` and applies only the current digest map. #6694's PR #1756 initially contained Bindery and Temporal updates. #6707 rewrote it to Temporal only; the final merged PR changed one line, and main retained the older Bindery pin.                      |
| Generated pin PR auto-merge is deadlocked    | **Corrected to P2 reliability**                           | #6695 and generated PRs #1754, #1751, and #1744 timed out waiting for review. However, after #6707 rewrote PR #1756, #6708 received `reviewed-clean-reaction` / `thumbsup-reaction` after 495 seconds and auto-merged. The provider is slow and has repeatedly timed out, but it is not permanently deadlocked.                |
| The image base is resolved twice             | **Confirmed design gap; no observed split-base incident** | `ci-changed.ts` consumes `ci-changed-base`, while `bake-images.ts --push` independently asks Buildkite for only the newest passed build. The bases matched in #6690, #6694, and #6707. A rebuild of an already-passed head can still make the second resolver return no base and fall back to all images.                      |
| The build summary omits hard lanes           | **Confirmed P2**                                          | A programmatic comparison found exactly five omitted main-only keys: `tofu-github`, `scout-tag-release`, `tofu-cloudflare`, `release-please`, and `version-commit-back`. In #6707, the summary began while `tofu-cloudflare` was still running.                                                                                |

### P1: the image no-change comparator ignores runtime configuration

`bake-images.ts` decides that a rebuilt image is unchanged by comparing only
`Image.RootFS.DiffIDs`. That suppresses expected differences in the injected
`VERSION` and `GIT_SHA`, but it also ignores all OCI runtime configuration.
A Dockerfile-only change to `CMD`, `ENTRYPOINT`, `USER`, `ENV`, health checks,
or labels can therefore produce identical layers and be classified
`content-unchanged`; no digest is recorded, no version pin is updated, and the
runtime change is never deployed.

This was reproduced against real Birmel images from #6690 and #6694: their
RootFS layer lists were identical while their manifest/config digests and
`VERSION`/`GIT_SHA` environment were different. That particular difference was
cosmetic and intentionally suppressed. The validated gap is that the same
mechanism cannot distinguish cosmetic config from meaningful runtime config.
The comparison needs the normalized image configuration as well as RootFS
layers.

### P2: image builds are selected more broadly than runtime inputs

The image selector correctly skips root documentation and the generated
`versions.ts` pin commit. Buildkite #6709 proves the pin-only path:
`images: unchanged ...; skipping`, with empty digest metadata.

There are nevertheless three sources of unnecessary work:

- `.buildkite/pipeline.yml` and `migration-core.ts` are global image inputs.
  A summary-only edit in either selects all 15 expanded image targets, while a
  summary implementation edit in `annotate-build-summary.ts` selects none.
- The `infra` selector target expands to six independently built images.
  Changing only the MCP gateway Dockerfile rebuilds Bindery, Caddy S3 proxy,
  Obsidian headless, MCP gateway, Redlib, and Shelfbridge.
- Package paths are treated as runtime inputs because Dockerfiles use broad
  package copies. The Temporal image copies all of `packages/temporal`; its 324
  tracked files include 86 test files and three Markdown files. A test-only or
  package-readme-only change therefore changes the image filesystem and
  legitimately triggers a new digest under the current Dockerfile, even though
  it is not a runtime change.

The current post-build gate avoids some pin churn but not the build/push:
`docker buildx bake --push` runs before the content comparison. Build #6694
selected, smoked, and pushed all 15 expanded targets; only Temporal and Bindery
were pinned, while 13 were later marked `content-unchanged`. Build #6690
similarly built 15 and pinned 11.

Meeting the desired invariant requires both precise selector ownership and
precise Docker contexts/COPY statements. A selector alone cannot skip tests or
Markdown while those files are actually copied into the runtime image.

### P2: Helm publishes every chart when only one manifest changes

`helm-push.ts` explicitly discovers every chart when no chart arguments are
provided. It rewrites each chart to the unique
`2.0.0-<build-number>` version, packages it, and posts it to ChartMuseum.
The pipeline always invokes it without chart names.

Observed artifact comparisons and pushes:

| Build range    | Changed synthesized manifests | Charts published |
| -------------- | ----------------------------: | ---------------: |
| #6694 to #6707 |  2 of 31 (`apps`, `temporal`) |               31 |
| #6707 to #6709 |          1 of 31 (`temporal`) |               31 |

Build #6709 was only the generated Temporal image-pin merge. Its Helm log
records `Pushing 31 chart(s) @ 2.0.0-6709` followed by 31 HTTP 201 responses.
Because repo-owned Argo applications track `~2.0.0-0`, every unnecessary chart
version is also eligible for reconciliation.

This is not merely redundant synthesis: 30 unchanged chart artifacts were
actually published in #6709. The chart publisher should compare manifest
content to the last promoted build and pass only the changed chart names.

### P2: any image pin causes an unrelated Scout release

The `site-scout` and `scout-reconcile` path sets include the entire
`versions.ts` file. Build #6709 changed only the Temporal pin, but that selected
Scout, archived and uploaded a complete 53.5 MiB frontend as `2.0.0-6709`,
deployed it to beta, and minted
`ghcr.io/shepherdjerred/scout-for-lol:2.0.0-6709` from the already-pinned Scout
digest `sha256:b3ec73f1a9aaa2b79b58ce3d8904c70e7d4ad15c40b4b111e0e0355d3fda0054`.
No Scout source, site artifact, image, or pin had changed.

Selection must be content-aware at the key level: only changes to Scout's own
beta/prod pins should trigger its deferred archive/tag/reconcile protocol.

### P2: broad selectors expand deployment blast radius

Every non-image lane prepends the same global paths: all of `.buildkite`,
`.mise.toml`, `bun.lock`, `bunfig.toml`, root `package.json`, `patches`, and
`turbo.json`. A summary-only pipeline edit therefore selects every deployment
lane, including sites, Helm, Argo, Tofu, npm, Cooklang, Scout reconciliation,
and the CI image. Some commands may be cached or idempotent, but the Helm and
Scout evidence above proves that selected lanes can create new release
artifacts.

Build #6709 also shows the operational consequence of a broad pin-only
deployment. After publishing 31 charts and the unrelated Scout release, it ran
a global Argo sync and failed after five minutes because `loki` and `media`
were not reconciled. The logs do not prove that the unnecessary publications
caused those resources to be unhealthy, so no causal claim is made. They do
prove that a Temporal-only pin unnecessarily exercised the whole GitOps
reconciliation surface and made that global state a hard condition for the
commit.

### P3: empty image metadata still clones the repository

Digest equality correctly prevents version-only churn, and an empty digest map
creates no commit or PR. However, `commitBack` authenticates and clones the
entire repository before it checks whether the map is empty. In #6709, the
image lane skipped, but `version-commit-back` spent about 47 seconds cloning
before printing `No digests provided`. The pipeline should skip the step, or
the script should return before authentication and clone.

## Fanout Correctness Findings

Three independent subaudits covered image correctness, Helm/GitOps promotion,
and release-state handling. Every finding below was then reproduced directly
against the current source, registry, Buildkite history, or live read-only
Argo/Kubernetes state. No P0 issue was found.

### P1: failed and canceled builds publish and deploy before terminal green

`helm-push` publishes each chart immediately as
`2.0.0-<build-number>`. All 31 repo-owned applications track the floating
constraint `~2.0.0-0` with automated sync, so publishing to ChartMuseum is
itself a promotion event; the later `argocd-sync` step is not the first moment
at which the build becomes deployable.

This was observed three times:

- Build #6649 was canceled after Helm passed and before `argocd-sync` started.
  ChartMuseum retains all 31 `2.0.0-6649` charts, and live Birmel history records
  automatic deployment of `2.0.0-6649` at 00:56:44Z, almost four minutes after
  the build was canceled. The chart carried a real Birmel image update from
  `2.0.0-6633` to `2.0.0-6646`.
- Build #6709 failed at 21:25:50Z, after publishing all 31 charts. Live `apps`
  history records `2.0.0-6709` deployed at 21:20:35Z, while the build was still
  running.
- Build #6721 failed during this audit, but ChartMuseum already contained all 31
  `2.0.0-6721` charts and all 31 repo-owned Applications had resolved that
  revision.

The publisher is a sequential 31-item loop with no staging or commit barrier.
A later chart failure therefore leaves earlier versions immediately visible,
and `apps` is published first, so child Application changes can become visible
before the corresponding child chart has been published.

The same pre-green promotion gap affects Scout release tags. Build #6709 minted
the still-present, Renovate-discoverable tag
`scout-for-lol:2.0.0-6709@sha256:b3ec73...` before its Argo failure. This has
already crossed into production once: failed build #6347 minted
`2.0.0-6347@sha256:0cff60...`, and merged PR #1687 later promoted that exact
failed-build release pair to the production pin.

### P1: the Argo tree gate can miss child drift

The custom health evaluator for an Application copies only the child
Application's `status.health.status`; it does not propagate
`status.sync.status`. `tree-health-wait apps` then checks only the root
Application's own `Synced/Healthy` state.

Live state demonstrated the blind spot during this audit:

- child `loki` was `OutOfSync/Healthy`;
- its last operation was `Failed`;
- its StatefulSet was `OutOfSync`;
- the parent `apps` resource nevertheless reported `Application/loki` as
  `Synced/Healthy`.

If no different child keeps aggregate health degraded or progressing, CI can
pass while a child's desired manifests remain unapplied. The gate also does not
assert that a changed child resolved the current build's exact chart revision.

### P1: removing an Application can orphan its workloads and still pass

The root pipeline prunes `apps`, but the live cluster had 59 Application CRs
and zero with either Argo resources finalizer. Deleting a child Application
therefore does not generally cascade deletion of its managed resources.

The pipeline already documents this exact failure for retired Kueue and
hard-codes a foreground deletion before the root prune because otherwise its
resources are orphaned. Any future child removal or rename has the same
failure mode: the Application disappears from health aggregation, its
workloads remain running and unmanaged, and the tree gate can become green.

### P1: CI toolchain images are promoted without testing the promoted image

All normal CI pods pull mutable `ci-base:latest` with `imagePullPolicy: Always`.
The main-only `ci-image-refresh` step depends only on `verify`, and `verify`
therefore runs using the previous image. The refresh then pushes both the
commit tag and `latest`; no PR or main step runs the real verification surface
inside the newly built image before promotion.

Build #6690 proves a single build crosses that boundary:

- `verify` ran 07:52:26–07:54:08 under the old image;
- `ci-image-refresh` pushed the new `ci-base:latest` and finished at 07:56:42;
- Helm, which explicitly depends on the refresh, started at 07:57:46 and pulled
  the new image.

Publication is also non-atomic. Build #6629's CI-image job successfully pushed
`ci-base:dfa0da3e...` at index digest `sha256:ffb68c...`, then failed while
building `ci-playwright`. The current script still builds the two images
sequentially.

`ci-playwright` has no runtime consumer: both actual Playwright jobs use the
pinned Microsoft Playwright image. It is nevertheless rebuilt, pushed, and
allowed to fail main. Build #6694 also republished both mutable `latest` tags
even though their linux/amd64 runtime manifests were byte-identical to #6690
(`ci-base` `sha256:5ddd27...`; `ci-playwright` `sha256:3dcf4d...`). Only the
top-level indexes/attestations changed. The last-green replay was correct; the
unnecessary mutation of `latest` after proving identical runtime content was
not.

### P1: an older commit-back writer can overwrite newer image state

`version-commit-back` has no concurrency group. Every invocation clones the
then-current `main`, resets the single shared pending branch to it, applies only
that build's digest map, force-pushes with lease, and enables auto-merge. It
does not assert that the originating build is still the main tip or that its
version/digests are newer than the values it is writing.

Therefore an older delayed job or automatic retry can start after a newer
writer, acquire a valid lease from its fresh clone, and replace newer pending
state or merge older digests onto current main. The already-observed #6707
rewrite that dropped the pending Bindery digest demonstrates the destructive
shared-branch behavior; tests cover the reset, but not stale-writer rejection
or monotonicity.

### P2: Scout image selection and compatibility hashing omit real inputs

`packages/scout-for-lol/scripts/contract-hash.ts` is executed by both the image
bake and site release and its output is baked into the backend image as
`CONTRACT_HASH`. It is absent from the image selector's target prefixes. A
deterministic selector call with only that path returned `targets: []`, so an
algorithm change rebuilds the SPA with a new hash while leaving the backend on
the old hash.

The hash's source closure is also incomplete. For example,
`riot.router.ts` directly uses `ResolveRiotIdInput` and the inferred result of
`resolveRiotIdExact`, but both the Zod input and `ResolveRiotIdResult` are
defined in `src/lib/player-admin/riot-search.ts`, outside every configured hash
glob. A real client-visible input/output contract change can therefore retain
the old compatibility hash.

### P2: several image smokes accept a hang as success

The shared in-image smoke treats timeout status 124 as success for Birmel,
Streambot, Scout, Discord Plays Pokémon, and Discord Plays Mario Kart without
first requiring a readiness signal. A pre-readiness deadlock can therefore
pass the image smoke.

The smoke bake and production push are also separate builds: smoke uses
`VERSION=dev` and `GIT_SHA=unknown`, while the pushed image is rebuilt with
release values. Bindery embeds those values into its binary and tests the
binary on Alpine as root even though the shipped runtime is distroless and
non-root, so the exact pushed artifact/runtime combination is not exercised.

### P2: moving image inputs can create digest bumps without a repository pin

Birmel and Streambot download the executable and checksum from yt-dlp's moving
`releases/latest/download` endpoint. The checksum authenticates the asset
served by that release, but the release version is not represented in the
repository. A cache miss can therefore change runtime bytes and produce a
digest bump without a corresponding dependency-version change in Git.

### P2: PR Helm validation accepts a missing synthesized chart manifest

`helmTemplateChart()` returns synthetic success when
`dist/<chart>.k8s.yaml` is absent. `helm-push --dry-run`, which is what PR CI
executes, also returns before the real manifest-existence check. A chart can
therefore lose its synthesis output and pass both PR gates, then fail the real
main push after zero or more earlier charts have already been published.
Current #6709 and #6721 artifacts were complete 31/31, so this is a latent gate
hole rather than current drift.

### P2: Cooklang can skip real manifest changes and fail after publication

Cooklang's idempotence gate downloads and compares only `main.js` and
`styles.css`; it explicitly excludes `manifest.json`. If the current manifest
version equals the latest tag, a change only to `minAppVersion`, description,
author metadata, or another manifest field exits as “nothing to publish.”

There is a second compatibility-boundary bug. The external plugin repository
and GitHub release are updated before monorepo commit-back. That commit-back
passes the nested
`packages/cooklang-for-obsidian/versions.json` path to a helper that always
stages root-level `versions.json`, so a `minAppVersion` boundary change
deterministically fails after the external release is already public.

### What is already correct

- Main work is selected from the last green ancestor to the current final
  snapshot, so red commits are not forgotten.
- Root docs and README-only edits select no images.
- A `versions.ts` image-pin-only commit selects no images.
- Workspace dependency closure, lockfile fingerprints, and patch attribution
  are materially more precise than a raw changed-directory check.
- After a build, layer-identical images do not create pin updates.
- Digest-equal entries in `update-versions.ts` do not rewrite `versions.ts`.

### Missing invariant coverage

The selector has substantial direct unit coverage, but cross-step and
cross-build invariants are missing:

- pending digests must survive a later build that changes only a subset;
- a config-dependent image and its manifest must promote atomically;
- meaningful OCI config changes must not be hidden by equal RootFS layers;
- unchanged chart manifests must not be repackaged and published;
- a non-Scout key in `versions.ts` must not release Scout;
- `bake-images.ts` must consume the selector's recorded base;
- the human summary must cover every hard main-only step.
- no chart or release tag may become consumable before the build is promoted
  green;
- the Argo root gate must incorporate every child's sync state and expected
  revision;
- pruning an Application must cascade or explicitly verify deletion of its
  managed resources;
- a CI-image candidate must run the real gate before `latest` moves, and an
  unused secondary image must not block or partially publish that promotion;
- commit-back writers must reject stale build versions and preserve newer
  pending digests;
- all inputs that alter an image's runtime configuration must select that image;
- every accepted smoke outcome must prove positive readiness;
- every chart directory must have a synthesized manifest in PR CI;
- Cooklang's idempotence check must include normalized manifest content.

The original focused CI suite passed 54 tests across the image selector, image
bake, last-green preparation, lane selector, build summary, and version
updater. The fanout rerun also passed the 10-test Helm template file. Those
tests validate existing behavior; they do not cover the invariants above.

## Session Log — 2026-07-28

### Done

- Correlated Buildkite #6673, #6679, #6681, #6690, and #6694 with their exact
  Git commits and job outcomes.
- Identified Buildkite #6690's first hard failure as the Argo CD health timeout,
  not the image lane.
- Proved that the new MCP gateway image was pushed before the failure and that
  PR #1754 later changed the deployed pin to that exact digest.
- Identified the incompatible intermediate state: new
  `github-mcp-server` configuration with the old `2.0.0-6529` image.
- Confirmed that Buildkite #6694 became healthy only after the compatible
  `2.0.0-6690` image was rolled out.
- Confirmed that #6690 and #6694 both selected changes from last-green #6673
  and that #6694 reran the accumulated MCP gateway image work.
- Revalidated every earlier audit claim against current source and live
  Buildkite/GitHub state, correcting the review-provider claim from a permanent
  deadlock to a repeated reliability/latency failure.
- Confirmed that the pending Bindery update was actually lost when #6707
  rewrote PR #1756 with only the Temporal digest.
- Audited no-change behavior for image selection, image content comparison,
  Docker contexts, Helm publication, Scout releases, version commit-back,
  global lane selection, Argo reconciliation, and the main build summary.
- Proved with Buildkite #6709 that a Temporal-only pin skips all images but
  publishes 31 charts, releases 53.5 MiB of Scout site content, mints an
  unchanged Scout digest under a new tag, and runs the global Argo sync.
- Compared synthesized artifacts across #6694, #6707, and #6709 and found that
  only 2/31 and 1/31 manifests changed while all 31 charts were published.
- Reproduced the RootFS-only image comparison blind spot against real registry
  manifests and identified its OCI runtime-configuration failure mode.
- Fanned the audit across independent image, Helm/GitOps, and release-state
  subreviews, then independently revalidated every retained finding.
- Proved that canceled #6649 and failed #6709/#6721 published all 31 charts and
  that Argo consumed those pre-green revisions.
- Proved that failed #6347's Scout release tag was later promoted to production
  by PR #1687.
- Reproduced the Argo child-sync blind spot against live Loki state and
  confirmed zero Argo resources finalizers across 59 live Application CRs.
- Reproduced the missing Scout image-selector input and audited the contract
  hash's transitive source closure.
- Proved from #6629 that a failed CI-image job published `ci-base` before
  failing on unused `ci-playwright`, and from #6690/#6694 that promoted CI
  images are not tested or content-gated before moving `latest`.
- Audited stale commit-back writers, image smoke readiness, moving Docker
  inputs, missing-manifest Helm validation, and Cooklang release idempotence.
- Ran 54 focused CI tests and 10 focused Helm tests successfully.

### Remaining

- None for the requested audit.
- Implementing and verifying the pipeline corrections requires a separate
  change request.

### Caveats

- Buildkite #6694 also contained PR #1755 and produced new Temporal worker and
  Bindery digests, so it was not a pure version-only replay. The MCP gateway pin
  that resolved the observed degradation nevertheless came from Buildkite
  #6690.
- The last-green change base remained Buildkite #6673, so later builds replayed
  accumulated main work rather than evaluating only their top commit.
- Buildkite #6709 ended failed because the global Argo tree did not become
  healthy. The audit does not attribute the `loki`/`media` state to the
  unnecessary Helm or Scout publications; it attributes only the unnecessary
  execution and expanded blast radius.
- Equal RootFS layers with different image configuration were observed. The
  meaningful `CMD`/`ENTRYPOINT`/`USER` failure mode is a direct consequence of
  the comparison algorithm, not an incident observed in these builds.
- The stale-writer downgrade, Application-removal orphaning, missing-manifest
  PR pass, smoke timeout, and Cooklang bugs are source-proven latent gaps. The
  pre-green Helm/Scout promotion, Argo child-sync invisibility, CI-base partial
  publication, unnecessary CI-image publication, and lost pending digest all
  have observed historical or live evidence.
- This was a read-only audit. No CI behavior, remote resource, branch, or PR was
  changed.
