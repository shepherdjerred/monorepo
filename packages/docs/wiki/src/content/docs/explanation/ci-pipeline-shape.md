---
title: How CI selects work
description: How Woodpecker selects workflows from changed files, limits concurrent work, and reports one required PR result.
sidebar:
  order: 2
---

Woodpecker generates a workflow only for work selected by the event and changed
files. Dependencies are included with that selection so every emitted workflow
has its required inputs.

## The pipeline is generated, not committed

There is no `.woodpecker.yaml` in this repository. When Woodpecker starts a
build it POSTs the repository, the pipeline, and the list of changed files to a
[configuration
extension](https://github.com/shepherdjerred/monorepo/blob/main/packages/woodpecker-config-extension/src/app.ts)
running in the cluster, and executes the workflows that come back.

That is where lane selection lives. The extension holds the whole step model —
each lane's image, resources, secret grants, dependencies, and change filters —
selects the steps a commit actually needs, closes the selection over its
dependencies, and emits one workflow per selected step.

Three consequences are worth stating plainly:

- **No bootstrap step.** Selection happens before any pod exists, so nothing has
  to start in order to decide what starts.
- **No second filter.** The emitted workflows carry no `when: path` clause. The
  selector already decided, using the same changed-file list Woodpecker would
  have filtered on; filtering twice would strand a dependent on a workflow that
  was quietly skipped.
- **Every request is verified.** The response is executed as a pipeline and the
  request carries repository credentials, so the extension checks Woodpecker's
  ed25519 signature — and recomputes the body digest rather than trusting the
  `Content-Digest` header it covers — before reading anything.

Feature-branch pushes and ordinary pull-request metadata edits select no work,
so the extension returns no workflows and Woodpecker records no pipeline and
posts no status for them. Draft PR pushes run a bounded preflight for formatting,
lockfile consistency, conflict markers and secrets. That feedback emits no merge
verdict. Marking a draft ready selects full PR verification without requiring
another commit. The signed ready event preserves the PR's credential approval
and cache trust. Ready pull requests select from changed files. Main pushes
compare the head to the last fully green main build, so a failed release's
changes stay selected on the next push. If that comparison cannot prove the
complete diff, the extension emits the full graph. The Linux `verify` workflow
uses its own last successful base, and checks PR changes against the merge base
with the PR target branch. Within that workflow,
[`scripts/verify.ts`](https://github.com/shepherdjerred/monorepo/blob/main/scripts/verify.ts)
runs six Turbo tasks at once. Most of them are short lint, typecheck and root
checks that used to queue behind long test suites. Vitest workers are what
oversubscribe the pod, so verify caps each suite at two workers. Six suites
then stay within the 12-CPU limit. Verify runs only the `ci` test tier; the
[second tier](#two-test-tiers) never runs on a pull request. Verify and
verify-extended diagnostics also carry per-suite JUnit timings
(`testTimings`), so `toolkit ci analyze --suites [--compare N]` explains a slow
test task by its files and compares a PR run with the nightly like-for-like.

Owner-requested local verification declares its build and test command names
in `localScripts` on the existing `separateTests` entry in
`scripts/ci-test-manifest.json`. Compliance checks require those commands to
exist and do real work, along with the package's lint and typecheck commands.
The launcher's `build:local` keeps native compilation out of the inherited
`^build` graph when homelab imports its publication contract. Run the declared
local checks before a manual release.

The extension passes the last green main base to every workflow. Selectors
inside the site, package publishing, CI image refresh, and Scout workflows use
it to skip unchanged targets. They
[deepen Woodpecker's shallow checkout](https://github.com/shepherdjerred/monorepo/blob/72f8413286f6412f2dab21e08444fcfda541218a/ci/scripts/selectors/ensure-ancestor.ts)
when the base is missing. Without a valid base they run conservatively, so
the base must travel with each workflow rather than only with `verify` and the
release chain.

First-party release versions do not produce Git catalog edits. The
[image producer](https://github.com/shepherdjerred/monorepo/blob/main/ci/scripts/images/bake-images.ts)
publishes immutable candidates and preserves original qualified artifacts for
unchanged recipes. Preservation depends on reproducible application images.
Each [install stage](https://github.com/shepherdjerred/monorepo/blob/53d083600b88a245fd1230fb8e5d49063ae20735/packages/birmel/Dockerfile)
copies only its workspace closure's manifests, as projected by
[`workspace-manifests.ts`](https://github.com/shepherdjerred/monorepo/blob/53d083600b88a245fd1230fb8e5d49063ae20735/ci/scripts/images/workspace-manifests.ts).
An edit to an unrelated package therefore leaves the install and every later
layer cached. A cache miss must still rebuild the same bytes. Bun's isolated
linker can skip bin links between dependency-cycle members on a cold install,
so
[`complete-bin-links.ts`](https://github.com/shepherdjerred/monorepo/blob/53d083600b88a245fd1230fb8e5d49063ae20735/ci/scripts/images/complete-bin-links.ts)
completes them. [Pushes](https://github.com/shepherdjerred/monorepo/blob/53d083600b88a245fd1230fb8e5d49063ae20735/docker-bake.hcl)
clamp layer file times to a fixed `SOURCE_DATE_EPOCH`. Steps that write logs
or tool state remove it in the same layer. Image files therefore share one
modification time, so
[game servers](https://github.com/shepherdjerred/monorepo/blob/53d083600b88a245fd1230fb8e5d49063ae20735/packages/discord-plays-core/src/webserver/image-file-options.ts)
never derive HTTP cache validators from it.
[Invariant tests](https://github.com/shepherdjerred/monorepo/blob/53d083600b88a245fd1230fb8e5d49063ae20735/ci/scripts/images/application-image-reproducibility.test.ts)
hold every application Dockerfile to these rules.

The clamp is BuildKit's export-time `rewrite-timestamp` option, and it costs
disk writes on the CI node. Upstream BuildKit
[re-converts every non-base layer on every export](https://github.com/moby/buildkit/blob/v0.35.1/exporter/containerimage/writer.go#L454-L495).
It decompresses each layer, rewrites the tar headers and recompresses the
result, even when the layer was a cache hit and the output is byte-identical to
the last push. `packages/homelab/images/buildkitd` holds a patched daemon that
records each rewritten blob on its source blob and reuses it. Images stay
byte-for-byte identical. That image is not deployed; its README lists the
enablement steps and how to drop the patch once upstream reuses rewritten
blobs itself.

The
[chart producer](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/scripts/helm/helm-push.ts)
freezes those exact inputs into immutable archives. Changed-file selectors and
the producer dependency closure determine CI work; there is no pin-only shortcut.
The catalog retains upstream and toolchain dependencies, while
[Delivery owns first-party release selections](/explanation/homelab/release-safety/)
in PostgreSQL. Publication does not select or reconcile a workload. CI has no
Argo sync, deployment credential or Git commit-back.

The verify and Playwright workflows use the first-party
[`ci-cache`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/ci-cache/index.ts)
service on `liskov` over the tailnet.
[Separate teams and signing keys](https://github.com/shepherdjerred/monorepo/blob/main/packages/woodpecker-config-extension/src/pipeline/turbo-cache.ts)
keep trusted main output separate from PR output, while copy-on-write read-through
lets `monorepo-pull-request` read `monorepo` entries on a miss without writing
back to `monorepo`. Developer shells default to local caching because their
network connection is less predictable.

`ci-cache` stores and returns each client's `x-artifact-tag` signature
unchanged. Signing keys stay with their respective clients. Turbo rejects
missing or invalid signatures, so a successful artifact download alone does not
prove a cache hit.

When the pinned CI image lacks a tool version, mise installs it once per node
onto the shared `woodpecker-mise-installs` claim instead of each pod's writable
layer (behind `woodpecker-mise-shared-installs-enabled`); the image's own
installs stay the read-only shared directory, and the claim has no collector
beyond `ZfsPVCStorageHigh` and the
[prune how-to](/how-to/prune-the-ci-mise-install-claim/).

Turbo caches whole package tasks, so any change to The Storm or a Rust crate
reruns its build. Each workflow's Gradle user home is private, leaving Gradle's
local build cache empty. Verify therefore also uses `ci-cache`'s HTTP WebDAV
stores over the tailnet for Gradle (`/cache/`) and `sccache` (`/sccache/`):
unchanged plugin modules and Rust compilation units load cached outputs instead
of rebuilding.

Neither Gradle nor `sccache` checks artifact signatures, so `ci-cache` enforces
the trust split through Basic Auth users instead. Default-branch verify holds
the `ci-main` write password; pull requests hold the `ci-pull-request` read-only
password, and `ci-cache` rejects writes from the read user. The
[pipeline](https://github.com/shepherdjerred/monorepo/blob/main/packages/woodpecker-config-extension/src/app.ts)
attaches one identity per trust domain
(`packages/woodpecker-config-extension/src/pipeline/gradle-build-cache.ts` and
`packages/woodpecker-config-extension/src/pipeline/sccache-webdav.ts`), and
[the build settings](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/plugin/settings.gradle.kts)
push only with the write password. Gradle and `sccache` fall back to local
compilation on remote errors, so an unavailable server costs speed rather than
correctness. `ci-cache` bounds its claim automatically with per-protocol TTL
expiry, high/low-watermark LRU eviction, and the daily `/v8/clean` sweep.

Woodpecker reports a GitHub status per workflow. A final, clone-free PR
workflow checks the selected blocking workflows at the same pipeline URL and
reports the single required `ci/woodpecker/pr/ci-complete` status. This avoids a
ruleset that names a status Woodpecker never emits. The cluster's CI admission
quota also bounds concurrent workflow pods and their aggregate storage request.

`ci-complete` uses a reserved completion pool and admission capacity, so long
builds cannot occupy every slot that reports the Woodpecker verdict. Its code
comes from the deployed policy image without a PR checkout. Automated review
runs outside Woodpecker on Temporal. PR and main work have separate agent
pools, and main receives the highest admission priority.
[Admission limits](/explanation/homelab/ci-admission/) still bound the combined
resource requests without preempting production workloads.

New verification replaces older work for the same PR, including ready events
and target-branch changes. The extension checks pipeline identity again before
canceling an older run. Newer runs, main and other PRs remain independent.

## Two test tiers

Verify runs the `ci` test tier: every step in a workspace's `ci-tests.json`
except those marked `tier: "extended"`. The split exists because the slow part
of verify was never the unit tests. In one main verify the integration suites
took 71 minutes of Vitest file time against 0.6 minutes for everything else;
media alone booted a private PostgreSQL cluster and ran 58 migrations in each
of 354 files. A verify that reached one of those suites spent 18 to 25 minutes
running a single task at two workers while holding its 8-CPU, 30 GiB slot, and
every cluster it started wrote to the CI node's SSDs. Rather than tune each
suite, the repository classifies them: a step that starts a server — a
database, the Temporal test server, ffmpeg, a game server — or whose uncached
p50 exceeds three minutes is `extended`, and pull requests do not run it. The
[test tier reference](/reference/ci-test-tiers/) holds the rule and the
per-workspace classification.

The extended tier runs in two places. The committer runs it locally for the
workspaces a branch affects before marking the PR ready, and records the
command and result in the PR body. A nightly Temporal schedule then dispatches
a manual pipeline on main that emits a `verify-extended` workflow and a
`paper-smoke-nightly` workflow at the lowest admission priority, so they wait
behind every pull request and main push, and run the whole tier uncached (see the
[workflow inventory](/reference/temporal-workflows/)). That run is a safety net,
not a main verdict: it gates no merge, and a red night raises an alert that
names the pipeline, with `toolkit ci explain` giving the failing step.

The accepted risk is that a PR whose author skips the local run can merge a
regression that only the nightly catches, up to a day later.

## CI runs only for the owner's own accounts

Steps in this pipeline mount production credentials — Cloudflare and Tailscale
tokens, an ArgoCD token, OpenTofu state keys, an npm token, a GitHub App private
key. Nobody else's change is worth that exposure, so the pipeline is not
generated for anybody else.

Two independent gates say so, and they fail in different directions on purpose:

- **Woodpecker's approval gate**, `require_approval` with
  `approval_allowed_users`, blocks a pipeline before any step is scheduled. The
  server defaults new repositories to `all_events`, so an unknown account's
  push or pull request waits for an explicit approval. This is the stronger
  gate, but it lives in the server's database, where nothing in this repository
  can assert it.
- **The extension's own allowlist** refuses to emit any workflow unless the
  account that owns the change is the owner, his agent account (`derrej`,
  which coding-agent sessions push as), or one of his bots — and, where
  Woodpecker reports one, the account whose action triggered this event too, so
  that nobody else can drive commits into a trusted account's pull request. The
  change must also not come from a fork. This gate is weaker, because it runs
  after the pipeline exists, but it is reviewable: it ships in the extension's
  image, and a branch cannot edit it into admitting itself. It is also the only
  gate in front of a cron pipeline, which Woodpecker's approval gate exempts.

The repository is trusted for `volumes` and nothing else. Steps mount the
shared CI caches as claims, which Woodpecker only allows a trusted repository;
`network` and `security` stay untrusted, so no step can run privileged or on
the host network. The trust is safe to grant only because every workflow comes
from the extension, for an allowlisted account.

A refusal is an error status, never `204`. To Woodpecker a `204` means "keep the
configuration you already have", which is the branch's own committed YAML — the
opposite of a refusal. For the same reason the server runs the extension in
exclusive mode, so there is no committed YAML to fall back to when the extension
fails.

## The lanes are phases, not duplicated test suites

The [browser lane](https://github.com/shepherdjerred/monorepo/blob/main/packages/woodpecker-config-extension/src/pipeline/lanes/playwright.ts)
runs on the default branch, and on a pull request only when it changes
`ci/ci-playwright/**`. It was the one pull-request lane past 15 minutes (29
minutes at p90, with 13% of runs reaching its 30-minute timeout) and used about
a third of CI CPU, so other pull requests skip it and the committer runs the
affected projects locally with `bun run e2e:affected` before marking the PR
ready. The exception exists for the `ci-playwright` image promotion, which
auto-merges once CI is green and bumps the pinned `@playwright/test` versions:
without it nothing would run the candidate image until the next main push. It
is keyed on that directory, not on `bun.lock` or a root `package.json`, which
would bring the lane back for most pull requests. The command wraps the same
[selector](https://github.com/shepherdjerred/monorepo/blob/main/ci/scripts/selection/run-playwright.ts)
the lane uses and compares against the merge base with `origin/main`; unlike the
lane, it stops with an error when that base cannot be found rather than running
every project. See the
[test tier reference](/reference/ci-test-tiers/#browser-and-paper-smoke-lanes).
The accepted risk is the one the extended tier carries: a regression only a
browser suite catches can reach main and fail the next main push, where this lane
gates `sites`.

On main, browser checks run alongside verification because their graph includes
the builds they need, and site publication waits for both lanes: `sites` deploys
the `sjer-red-dist` and `wiki-dist` bundles the lane publishes. Static wiki
output has direct artifact checks, while browsers still exercise navigation and
rendered behavior. The Paper smoke is likewise off pull requests: it runs as a
second workflow of the nightly extended pipeline, and committers run `test:smoke`
locally. The [portable Windows test graph](https://github.com/shepherdjerred/monorepo/blob/main/packages/tasknotes-windows/turbo.json)
produces test and coverage evidence in one execution; the coverage thresholds
remain unchanged.

- **Browser E2E** covers the shipped Playwright consumers: `sjer.red`, the docs
  wiki, the alert dashboard, Delivery, Tracker, Media, and Scout's
  public/docs/app design audit. The
  [target list](https://github.com/shepherdjerred/monorepo/blob/main/ci/scripts/selection/playwright-targets.ts)
  is the authority. The browser matrix comes from the pinned `ci-playwright` image, so the
  lane is about published sites rather than about Playwright as a tool. The
  lane installs the pinned Node runtime alongside Bun so Scout's static
  Storybook preview serves the full catalog without Bun's HTTP stream failure.
  The design audit uses a deterministic local boot and fixture; see [Run the Scout
  design audit](/how-to/run-scout-design-audit/).
- **llm-observability E2E** is the dedicated tracing-stack lane. It starts Tempo
  and MinIO as workflow services and runs only
  `@shepherdjerred/llm-observability`'s service-dependent tests. That live
  backing stack is what sets it apart: `alert-dashboard-sqlite` also runs
  integration tests for the alert ledger, but against a local SQLite file rather
  than a service. This lane is the only one needing a whole trace pipeline,
  where a failure means the exporter/collector/object-store path broke rather
  than a query.
- **OpenTofu** is validated on pull requests and never planned or applied by
  CI. One credential-free step regenerates the provider bindings, fails when a
  committed `main.tf.json` differs from a fresh synthesis, and validates every
  stack offline. Every main build publishes each stack's exact source as an
  immutable archive (`tofu-archives`) that Delivery plans and applies from, so
  provider and remote-state credentials stay out of CI. The stack manifest
  declares the repository files a stack reads outside its directory, and the
  homelab lint fails on an undeclared read.
  [Change an OpenTofu stack](/how-to/change-an-opentofu-stack/) gives the
  procedure.
- **npm channel packages** (webring) are frozen as tarballs on every main
  build under the v2 catalog (`npm-package-archives`). A published version
  keeps the bytes npm serves; an unpublished version is the package's
  reproducible `bun pm pack`. The `webring/latest` channel deployment
  publishes and moves `latest`, so the package publish lane no longer
  publishes webring. release-please still proposes the version bumps.
- **Scout** has three deliberate promotion phases: archive and deploy beta, mint
  the immutable tag, then reconcile the production `versions.ts` pin. They are
  three stages of one release, not three independent Scout test suites.
- **Toolchain image candidates** rebuild `ci-base` and `ci-playwright`. Main
  builds publish a content-addressed candidate and open a pull request that
  moves the committed digest. Under the Delivery v2 catalog, Delivery's `ci`
  service records the committed digests, not the candidate: every main push
  registers one build that covers both (`ci-images-register`), retaining each
  image Delivery already qualified, so a new set appears only when a digest
  changed or the service has none yet. Delivery qualifies that build against
  the push pipeline itself, which it would refuse for the manual maintenance
  pipeline that runs the refresh. Image-promotion PRs from
  `long-summer-intern[bot]` are reviewed by Codex like any other PR and merge
  through their own `gh pr merge --auto`; no human step remains unless Codex
  is usage-limited.
  The macOS and Windows cross-compiler build lanes are paused; they do not add
  work to the default pipeline, and their images have no Delivery producer.

## Native Apple checks are paused

Linux `verify` remains the first hard correctness gate, but it cannot exercise
Xcode, code signing, or macOS UI automation. The native Woodpecker lanes for
QuotaBar, hkctl, and TaskNotes are currently paused while the Mac agent's GUI
audit session is repaired.

When resumed, those phases select the Mac Mini by its `platform=darwin/arm64` agent label and
serialize in one concurrency group. They run on Woodpecker's **local backend**:
there is no container and no pod, which is the only way Swift and Xcode run at
all. That is also why they carry no credentials — with no pod there are no
Kubernetes secret grants to attach — and why fork pull requests must never
reach them. Fork code is held at the repository level by Woodpecker's approval
setting rather than by a guard on each step.

Affected PR code runs directly in an unlocked macOS user session, so the host
contains only the development certificate and permissions those tests require.
Release signing, notarization, iOS simulators, devices, CocoaPods, and Maestro
remain outside that surface.

## Optional scans fail differently on purpose

**Trivy** and **Semgrep** are finding scans. A finding is not a build failure;
a scanner that could not run is.

That distinction used to be expressed as a list of soft-failed exit statuses in
the pipeline. It now lives inside each scanner's own command: the lane exits 0
when the tool reports findings and propagates any other failure. This is
stricter than the exit-status list it replaces, which could not tell a findings
exit from a crash that happened to share its code.

The split matters either way: a soft-failed scanner would silently stop scanning
and still look green.

## The review gate waits for the exact head

Temporal orchestrates the required `ci/code-review` commit status instead of a
90-minute Woodpecker polling pod
([`pr-code-review.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/ci/pr-code-review.ts)).
Waiting on external reviewers is durable state coordination, not container
compute. Holding a CI pod open for ninety minutes wasted admission slots and
required pipeline restarts whenever a review arrived late.

Repository configs disable automatic push reviews on every provider. Instead,
[`codeReviewCoordinatorWorkflow`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/ci/code-review-coordinator.ts)
assigns one reviewer per pull request through Smooth Weighted Round-Robin
([`weighted-round-robin.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/code-review/src/weighted-round-robin.ts)).
Free public-repository tiers (`cubic`, `coderabbit`, `codeant`, `qodo`, and
`greptile`) carry normal review load while `codex` stays a low-weight reserve.
Requesting one provider per pull request avoids burning every quota on the same
diff.

Provider failures stay isolated in the coordinator. Rate-limited and timed-out
providers enter a temporary cooldown, while seat-blocked or skipped outcomes
fail over to the next eligible reviewer without cooling down the provider for
other pull requests
([`pr-code-review-helpers.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/ci/pr-code-review-helpers.ts)).
When every configured provider is quota-blocked, times out, is skipped, or none
are configured, `ci/code-review` passes unless an unresolved P0 stands. Billing
states and bot-skip rules must not stop unrelated merges.

Binding to the exact head commit remains mandatory. A review from an earlier
push judged different code, so accepting it on round one would approve
unreviewed changes. Round one blocks strictly on unresolved P0 and P1 findings
under `STRICT_P0_P1_POLICY`, leaving P2 and P3 findings advisory
([`gate.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/code-review/src/gate.ts)).
Once any provider has reviewed an earlier commit, later pushes skip re-review
and block only on an unresolved P0. Waiting on every follow-up push previously
spent hours reviewing churn from earlier feedback.

Reads run as the GitHub App installation rather than Jerred's personal account
([`github-app-token.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/lib/github-app-token.ts)).
An installation has its own API quota, so polling open pull requests cannot
starve local `gh` or agent sessions. Only review-request comments use
`GITHUB_REVIEW_TOKEN` on `temporal-repo-worker`, because providers like Codex
ignore bot-authored trigger comments
([`code-review-octokit.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/ci/code-review-octokit.ts)).

The installation bucket still needs bounded GraphQL spend. Each Temporal
observation fetches one provider-agnostic GraphQL thread and review listing and
partitions it across all providers in memory rather than querying per provider
([`github-review-snapshot.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/code-review/src/github-review-snapshot.ts)).
Polling runs on bounded Temporal timers (30 seconds while awaiting a review, 60
seconds while watching blocking threads), while `toolkit pr review resolve` and
`toolkit pr review recheck` signal `recheckReview` for immediate re-evaluation.

## Handoffs go through object storage

Steps pass values to later steps through a build-scoped SeaweedFS prefix,
`s3://ci-handoff/<pipeline number>/<key>.json`, written and read by
[`ci-handoff.ts`](https://github.com/shepherdjerred/monorepo/blob/main/scripts/lib/ci/ci-handoff.ts).

There is one path rather than two. Woodpecker has no build metadata store or
artifact store. One storage path with no size threshold is simpler than
separate small-value and large-value stores. No handoff has to choose between
them, and a value that grows never moves from one to the other.

Reads fail loudly by design. A defaulted `{}` would let a release step deploy
nothing and report success.

Nothing in the bucket needs to outlive its build for long. The `seaweedfs`
OpenTofu stack gives it a lifecycle rule that expires every object after seven
days. No step reads
another pipeline's handoff except a reviewed platform plan, and that plan is
refused after 24 hours. Evidence that must be kept belongs in a durable bucket.

[Each workflow](https://github.com/shepherdjerred/monorepo/blob/main/packages/woodpecker-config-extension/src/pipeline/emit.ts)
has its own checkout and dependency tree. The
[handoff](https://github.com/shepherdjerred/monorepo/blob/main/scripts/lib/ci/ci-handoff.ts)
and [artifact](https://github.com/shepherdjerred/monorepo/blob/main/scripts/lib/ci/ci-artifact.ts)
helpers import an S3 signer declared by the [root scripts
package](https://github.com/shepherdjerred/monorepo/blob/main/scripts/package.json).
The [Helm chart publication step](https://github.com/shepherdjerred/monorepo/blob/main/packages/woodpecker-config-extension/src/pipeline/lanes/artifacts.ts)
installs that package's production closure with its own packages before writing
release handoffs. This keeps the step's install filtered to its own work.

The store has its own SeaweedFS identity, scoped to the `ci-handoff` bucket and
nothing else. That is what lets `verify`, `playwright-e2e` and `resume-build`
run on every pull request: they move build values between steps, so they need
this credential, and it cannot touch a published site or the OpenTofu state.
The scope is on the bucket rather than a prefix because the same bucket also
holds `ci-artifact`'s `artifacts/` trees, and a prefix grant would break those
while the handoff half kept working.

## Release refinement verifies the agent's result

The [release refiner](https://github.com/shepherdjerred/monorepo/blob/main/scripts/lib/release-refiner.ts)
constrains Codex's final response with a JSON schema derived from its validation
contract. This prevents formatting errors, such as truncated commit SHAs, from
turning completed edits into an unreadable success report.

Schema compliance alone cannot prove that an edit happened. The runner separately
checks GitHub's pending release PR, exact head, commit author, changed CHANGELOGs,
and package sections in the PR body. Missing or inconsistent evidence fails the
release lane.

## Release refinement has its own authentication boundary

The main-only release refiner can use a ChatGPT subscription for Codex without
placing a reusable credential in ordinary CI steps. Its step mounts a persistent
auth bundle that Codex refreshes in place, while other steps do not. The release
lane is serialized, so a single-writer volume is sufficient. The bundle is
deliberately excluded from backups because recovery means reauthenticating on a
trusted operator machine.

This separates a renewable login session from an extracted short-lived token.
The distinction lets the release refiner recover normally when its Codex access
token expires without broadening the rest of the CI credential surface.

## Credentials follow issuer and rotation boundaries

CI credentials are stored in 1Password by issuer or rotation unit, not by an
arbitrary target number of Secrets. GitHub, Turbo, npm, Claude, Charts,
Argo CD, SeaweedFS, Cloudflare, Tailscale, and the ARR and tracker services
therefore have independent items and Kubernetes Secrets. Semantic field names
distinguish identities that may initially carry the same value but must rotate
independently later, such as GitHub download, review, package publication, App,
and OpenTofu access.

That last sentence is a licence worth using carefully, because it describes an
intention rather than a boundary, and the two are easy to confuse. SeaweedFS is
the worked example: `SEAWEEDFS_STATE_*` and `SEAWEEDFS_DEPLOY_*` read as a
boundary for a long time while holding one value — the gateway's only identity,
carrying unscoped `Admin` over every bucket. Every step granted either pair
could rewrite the OpenTofu state and every published site.

SeaweedFS now has five identities that are genuinely distinct, each scoped in
the gateway to the buckets its job touches:

| Field                    | Reaches                                    |
| ------------------------ | ------------------------------------------ |
| `SEAWEEDFS_HANDOFF_*`    | `ci-handoff` only                          |
| `SEAWEEDFS_SITES_*`      | published-site and release-archive buckets |
| `SEAWEEDFS_TOFU_STATE_*` | `homelab-tofu-state` only                  |
| `SEAWEEDFS_APPLE_SDKS_*` | `apple-sdks`, read-only                    |
| `SEAWEEDFS_TOFU_ADMIN_*` | everything — see below                     |

`SEAWEEDFS_TOFU_ADMIN_*` is deliberately unscoped: the `seaweedfs` OpenTofu
stack manages the buckets themselves, and SeaweedFS requires unscoped `Admin`
to create one. No CI step holds it. Only the Delivery platform Job that plans
and applies `tofu-seaweedfs` receives it, through
[`deliveryTofuGrants`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/delivery-platform-grants.ts)
and that stack's
[credential manifest](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/scripts/tofu/tofu-stack-manifest.ts).
The
[Delivery boundary test](https://github.com/shepherdjerred/monorepo/blob/main/packages/woodpecker-config-extension/test/delivery-boundary.test.ts)
fails if any step of the CI graph is given it.

The scoping lives in the identities config the S3 gateway loads through
`existingConfigSecret`, which exists only in a 1Password item. No repository
check can see it, so the boundary is proved by probe — each identity must be
**denied** a bucket belonging to another — and that denial is the acceptance
evidence for any change to it. A positive probe alone cannot tell a scoped
identity from an admin one.

The storage policy's `siteBuckets` and the `delivery-static-activator`
identity must name the same buckets; an omitted bucket blocks deployment with
`AccessDenied`. See
[the release guide's site-permission procedure](/how-to/cut-a-homelab-release/#if-a-static-site-deploy-gets-accessdenied)
when adding a bucket.

Each generated step names the exact secrets and keys it needs, and the agent
turns those into `secretKeyRef` entries with
`WOODPECKER_BACKEND_K8S_ALLOW_NATIVE_SECRETS`. Credentials therefore stay in
1Password-synced Kubernetes Secrets and never enter Woodpecker's own secret
store or its database. Every step pod uses the tokenless `woodpecker-job`
service account without a RoleBinding and disables service-account token
mounting, so a step cannot use Kubernetes RBAC to discover another Secret.

:::caution
Step logs are **not** redacted. Woodpecker masks only secrets from its own
store, and native Kubernetes secrets are external to it. Keeping credentials in
1Password costs the redactor. Do not echo
a credential in a step command.
:::

The grant contract is checked rather than written twice. `check-ci-env` reads
the generated step model directly — not a committed pipeline file — and fails on
missing grants, blank or unknown 1Password fields, the wrong
service account, or a token mount. It does **not** detect an _excessive_ grant:
it reports a step that cannot meet a requirement, never one holding more than
it needs, so a credential quietly spreading to another step passes it. That gap
is covered where it matters most by `pr-reachable-secrets.test.ts`, which pins
both the exact set of credentials a pull request can reach and the exact list
of steps allowed to write a published site. A credential expansion therefore needs an
explicit change to a lane definition that appears in the diff.

The stable field names make later rotations pipeline-independent. The
[CI credential rotation procedure](/how-to/rotate-ci-credentials/) defines the
reconciliation, acceptance, and archival checks.

## Related

- [About the monorepo](/explanation/monorepo/) — why CI is self-hosted at all
- [Why releases are shaped this way](/explanation/homelab/release-safety/)
- [CI admission](/explanation/homelab/ci-admission/) — where CI runs
