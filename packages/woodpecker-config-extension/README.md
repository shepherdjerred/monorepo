# woodpecker-config-extension

Generates this repository's CI pipeline for each Woodpecker build.

Woodpecker calls a [configuration extension](https://woodpecker-ci.org/docs/usage/extensions/configuration-extension)
instead of reading committed workflow YAML. It posts the repository, the
pipeline, and the list of changed files; this service replies with the
workflows that build should run. Lane selection happens here rather than in
a bootstrap pod, so no step has to start before the graph is known.

## Why the pipeline is data, not YAML

`src/pipeline/model.ts` describes a step: its key, dependencies, changed-path
guard, resource tier, and the exact credential grants it receives. Selection
(`select.ts`) decides which steps run; emission (`emit.ts`) decides what
Woodpecker is told to do. Keeping those separate is what lets the selector
guarantee a dependency-closed set, which the emitter then relies on.

## Things that are load-bearing

- **Signature verification is not optional.** The response body becomes an
  executed pipeline. Requests are verified as RFC 9421 ed25519 signatures, and
  the `Content-Digest` header is recomputed against the body — the signature
  covers that header, not the body, so without the recomputation a captured
  header set could be replayed against a substituted body.
- **Selection must be dependency-closed.** Emitted workflows carry
  `depends_on` and deliberately no `when` clause. A dependency that was
  filtered out would leave its dependent permanently unrunnable — a lane that
  silently never runs rather than one that fails.
- **An empty changed-file list runs everything.** A release lane that quietly
  does nothing and reports success is worse than one that runs redundantly.
- **CI images are resolved per commit.** The digests are committed and rotated
  by the image lane, so baking them into this service would pin every build to
  whatever was current at deploy time.

## Dependency caches

Owner manual benchmarks on `ci-canary/` branches accept the `scratch` feature
for the `verify` profile. Candidates require the typed
`woodpecker-ram-scratch-enabled` flag; its production default is off.
The shared profile in `src/pipeline/ram-scratch.ts` reserves the full bounded
scratch allowance above the verify process budget. Homelab admission adds
memory-backed volumes only to the marked execution pod, preserving clone,
service, checkout, and report storage. Ordinary pipeline selection does not
activate scratch, even when the flag evaluates true.

The admission graph includes this canary when inspected with
`bun src/dump-steps.ts --include-canaries`; the root admission-budget check
uses that graph to verify coexistence with ordinary workflows.

Source caching is controlled by the typed `woodpecker-source-cache-enabled`
flag. The production inventory enables it; the runtime fallback remains off.
Branches under `ci-canary/` have beta targeting. The
configuration service uses the `woodpecker` Flipt namespace; unavailable flags
keep ordinary checkout active and invalid values fail visibly.

Ordinary Kubernetes checkouts explicitly use the trusted deployed catalog's
digest-pinned Git plugin with `depth: 0` and `partial: false` for full history;
the plugin's default partial mode would override the depth. Tag events also
fetch tags. Clone, command, and service pods all carry the workflow step key,
commit, and branch/pipeline annotations for I/O attribution, plus their resource
bounds and tokenless service account. Checkout-free and local workflows retain
their own startup paths.

When enabled, the deployed digest-pinned service image supplies a trusted
clone helper. Its preparation and checkout containers alone mount the main or
approved-PR source PVC, plus the separate coordination PVC. A pinned BusyBox
image from the deployed extension's catalog prepares ownership of the empty
workspace and cache mount roots without traversing cached objects. This is
required because the ZFS driver's ownership policy excludes RWX claims.
The helper then runs as UID/GID 1000. A final trusted container transfers only
the private workspace and `.git` directory roots to the root build user so later
Git commands pass ownership checks. It does not mount the source cache or
traverse objects. All three containers use the tokenless CI service account and
disable privilege escalation. Unapproved automation uses ordinary
checkout. Each cache entry contains depth-one Git objects, a shallow boundary,
and an exact repository/commit/tree manifest. No Git config, hooks, credentials,
dependencies or build output enter it. The helper checks object integrity,
copies objects into a private `.git`, and materializes every tracked path with
its original mode and symlinks. Origin and later history fetches remain usable.

Clones hold a shared GC lock and an exclusive per-commit lock. This collapses
simultaneous misses and prevents collection during reads. The existing Temporal
cache maintenance activity evicts entries unused for seven days and then the
oldest entries above 8 GiB in each 10 GiB data claim. Disabling the flag rolls
back checkout behavior without deleting claims. `CI_CHECKOUT_DIAGNOSTIC` logs
cache outcome, source SHA, object bytes downloaded, fetch/materialization time,
and total helper time; object bytes exclude network protocol overhead.

Registry access uses explicit per-lane grants. Image and toolchain publishers
and Scout tag publication receive the scoped Docker Hub publisher identity.
Scout site extraction and immutable image metadata verification receive only the reader Docker configuration from
`dockerhub-pull-woodpecker-ci`. The login helper validates the account and sends
the token through standard input. These grants are main-only; pull-request
commands receive neither registry identity. Publishing and CI toolchain images
use Docker Hub. The publisher verifies the registry catalog's visibility policy
before recording original artifacts. The review-image parser accepts existing GHCR
extension digests during deployment transitions.

Shared download caches are paired with explicit tool paths: Bun uses
`/woodpecker/bun-cache/data`, and uv uses `/woodpecker/uv-cache`. The emitter
only supplies a shared path when its declared volume is mounted. Bun's download
cache and its maintenance-lock volume must be mounted together. The trusted
graph mounts that pair on every in-cluster container that runs
`ci/scripts/bun-install.sh`, so no lane downloads its dependency closure into
`~/.bun` on the CI node's OS disk; the credentialless hosted-automation graph
mounts no shared cache. Installed dependencies remain private to each workflow
workspace. Verify and Playwright use `TURBO_CACHE=remote:rw`: each is one Turbo
run in a fresh workspace, so a local cache there would be written and never
read.

### Experimental workspace reuse

The `woodpecker-performance` flag declarations default off in production and
target `ci-canary/` branches as beta. Each optimization resolves separately:
incremental source fetch, prepared workspaces, formatter results, Gradle
dependency seeds, small-check grouping, and Bun's explicit copyfile backend.
Credentialless automation receives none of these caches.

Incremental source misses copy and verify recent immutable objects before
advertising a temporary negotiation ref. Fetch still requests the exact SHA;
the helper validates its commit and tree and removes the temporary ref.
Diagnostics distinguish the seed SHA from the requested source SHA. A seed
over 2 GiB starts a fresh fetch instead, bounding accumulated objects across
successive incremental generations within the existing source-cache GC budget.

Prepared workspaces use immutable generations on `woodpecker-workspace-seeds`
(60 GiB), copied with the filesystem clone facility into each private workflow
volume. A fingerprint covers the image digest, platform, dependency manifests,
lockfile, patches, linker configuration, tool pins, and seed implementation.
The source SHA is separate, allowing an unchanged dependency closure to serve
a newer source tree. Git's index and hard reset apply source additions,
renames, and deletions after restoration. The frozen Bun installer remains
authoritative. Only tracked source and installed dependency directories enter
a seed; Git configuration, credentials, hooks, and untracked build outputs do not.
Relative dependency links must remain inside the workspace.

Only default-branch manual maintenance publishers can write the seed claim;
the source must equal the latest fully successful main push, including for
direct manual requests. Superseded or unverified requests publish no seed.
Native Kubernetes admission makes every other container mount read-only while
leaving CSI mounts read-write, as required by shared ZFS volumes. Readers hold
the shared seed lock through copying; publication and collection take it
exclusively. Collection retains two generations per profile and publication
defers above 70% filesystem use. Missing compatible seeds are ordinary cold
starts; invalid published identities fail visibly.

Gradle retains a private writable home. Seed publication copies only its
`modules-2` dependency cache, excluding lock files and `gc.properties`.
Consumers clone that immutable cache into private Git metadata before releasing
the reader lock and set `GRADLE_RO_DEP_CACHE` there. Daemons, journals, mutable
homes, and build outputs are never shared. Gradle itself comes from the pinned
mise image; this repository does not use a Gradle wrapper distribution cache.

Prettier uses content validation with a private cache file per shard/job and
atomic publication only after every chunk succeeds. Plugin lock, runtime,
configuration, ignore, and package-manifest changes invalidate results. Main
and PR results occupy separate 128 MiB claims; admission forbids PR access to
the main claim. Four recent configuration keys are retained per shard.
Typed ESLint remains unchanged. Turbo diagnostics retain sanitized file hashes
and declared variable names for input auditing, never environment values.

The grouped `small-pr-checks` prototype is selected only for trusted PRs where
both release rehearsal and SQLite checks were selected. It shares checkout and
installation while preserving per-container credentials, resources, timeouts,
and failure status. Both checks run after an independent check fails; a failed
shared setup prevents either check from claiming success.

### Benchmark request contract

A signed owner manual request on main or `ci-canary/` may supply all five
variables below. The route is exclusive: it emits one verify/browser workflow
and diagnostic handoffs, with no application artifact publication or releases.
Other work continues to use normal selection.

| Variable               | Values                                                                   |
| ---------------------- | ------------------------------------------------------------------------ |
| `CI_BENCHMARK_PROFILE` | `verify`, `browser`                                                      |
| `CI_BENCHMARK_SOURCE`  | Exact 40-character pipeline commit SHA                                   |
| `CI_BENCHMARK_VARIANT` | `baseline`, `candidate`                                                  |
| `CI_BENCHMARK_CACHE`   | `cold`, `warm`                                                           |
| `CI_BENCHMARK_FEATURE` | `incremental`, `prepared`, `formatting`, `gradle`, `copyfile`, `scratch` |

Candidate requests enable only the named optimization and require its beta
flag to resolve true. Cold runs use a private source-cache destination and
disable Turbo result reuse; incremental candidates may negotiate from a
different verified shared SHA. Download caches remain warm, so this is a cold
source/result comparison rather than a purge of production package caches.
The private source cache lives under the workflow's `.git` directory, keeping
it writable by the clone user, outside build inputs, and on the workspace volume.
Warm runs use ordinary exact-SHA source and signed Turbo result caches. A moved
source, conflicting maintenance/platform/corpus parameters, or disabled
candidate is rejected. A fixed canary branch allows repeated pairs while main
continues advancing. `CI_IO_FIXED_CORPUS` is not used by this route.

Verify fetches the frozen commit's immediate predecessor before selecting its
coverage baseline when no verified changed base is available. Fetching main
alone does not remove a canary checkout's shallow boundary after a squash merge.
A missing predecessor stops verification before an empty baseline can be exported.

`CI_CHECKOUT_DIAGNOSTIC`, `CI_BOOTSTRAP_DIAGNOSTIC`, and
`CI_INSTALL_DIAGNOSTIC` separate source, toolchain, and install time. Retained
Turbo summaries provide task/cache evidence; `toolkit ci timings --json` also
keeps native queue/startup phases distinct from process timings. Device-write
and memory measurements must come from node telemetry, including a settling
window after completion and the amortized image/seed refresh cost. A task's
logical object-byte count is not a physical NVMe-write measurement.

Scratch verification benchmarks additionally retain resource samples inside
`diagnostics-verify.json`, starting before installation and finishing after the
command exits. The dependency-free wrapper reads cgroup v2 memory current/peak,
limit and event counters plus both scratch filesystems every ten seconds and at
completion. Candidates require two distinct tmpfs mounts. Samples report each
tmpfs's capacity, usage and available bytes; a disk baseline reports shared
filesystem capacity, which does not measure that directory's size. Usage peaks
between samples can be missed, while the cgroup peak/events are cumulative.
Missing counters, changed limits, resets, or a truncated collection cannot pass
the resource diagnostic gate; an existing command failure keeps its exit code.
The fresh-process diagnostic transfer uses a bounded stdin pipe, independent of
both candidate tmpfs and baseline workspace space, with no sample data in argv.
Ordinary workflows do not start this sampler. Physical SSD writes and foreign
workload isolation still require node telemetry and native CI evidence.

Nothing a step writes should land on the container's writable layer, which is
the CI node's OS disk. Shared Bun installs extract into `bun-cache/tmp`, beside
the data directory, so extraction is a rename on the cache volume rather than a
copy from `~/.bun`; the cache collector clears it under its exclusive lock.
`ci/scripts/toolchain.sh` points `TMPDIR` at `/woodpecker/tmp` on the workflow
volume.

Toolchain caches that tools otherwise keep in the home directory are separate
shared claims, mounted by `withSharedToolCaches` on every trusted container
that sources `ci/scripts/toolchain.sh`: the tool cache (`XDG_CACHE_HOME`,
`NUGET_PACKAGES`, and `BUN_INSTALL` for `bunx` inside tasks) on every scope,
plus Cargo's registry and Git caches, sccache, Go's module and build caches,
and uv's Python installs on the full scope. Gradle's writable user home stays
on each workflow's volume at `/woodpecker/gradle`: its cache locks require
communication between processes, which separate pods cannot provide. The
toolchain preamble overrides shared Gradle paths from older pipeline definitions
so the source repair takes effect before the extension itself is deployed.
Cargo has no variable for its caches alone, so the toolchain preamble links
`~/.cargo/{registry,git}` to the mounted claim instead of moving `CARGO_HOME`.
The root `turbo.json` passes every such variable through strict env mode so
tasks inherit them; `BUN_INSTALL_CACHE_DIR` is deliberately not passed, because
it names the collected cache whose readers hold the collector's lock. None of
these caches has a collector: Cargo, Go and sccache expire or bound
their own entries, and the homelab's per-claim usage alert covers the rest.
The source-cache clone copies Git objects with the filesystem's clone facility
(`cp --reflink=auto`), which ZFS turns into a block clone within the pool.

## OpenTofu PR checks

Selection retains the existing per-stack path guards. Selected PR plans and
validations then run as ordered containers in one `tofu-pr` workflow, sharing
one checkout and one filtered Bun install. Each container keeps its original
credentials, mounts, resource bounds and timeout. A failed required container
fails the workflow and the completion verdict. Main applies stay separate.

The setup and plan containers install only Bun and OpenTofu. Plans retain the
shared provider-cache lock and use a private temporary `TF_DATA_DIR`, removed
on success or failure, so backend initialization never persists credentials
in the shared checkout. Schema-only validation retains its independent data
directory and does not use the shared provider cache.

## Agent pools and admission

Marking a draft ready emits Woodpecker's signed `pull_request_metadata` event
with reason `ready_for_review`. It selects the full PR graph without another
commit. Title, label and other metadata changes emit only a no-op. Ready events
retain PR credential approval and cache namespaces, and use the PR merge base.
Completion checks the native metadata statuses from its own pipeline. The
server maps only that completion workflow to the existing required
`ci/woodpecker/pr/ci-complete` status. Toolkit selects the newest matching PR
or ready-event pipeline and rejects draft-only evidence at the same SHA.

Native cancellation can miss ready events and target-branch changes. After
producing an authorized PR configuration, the extension cancels older PR and
ready-event runs for that exact PR, including duplicates at the same commit.
It revalidates each
pipeline immediately before cancellation and never cancels newer runs, main,
or another PR. Metadata no-ops and unapproved automation do no cleanup.
The entire best-effort lookup has a three-second deadline; API failure leaves
the replacement verification intact and emits a bounded warning.

Draft pushes run a three-minute preflight for formatting, frozen lockfile
consistency, conflict markers and secrets in the proposed commit history.
The filtered install includes root formatting plugins and script dependencies,
with lifecycle scripts disabled.
They create no merge verdict, browser/Tofu/rehearsal jobs or review poller.
Hosted automation without exact-head approval keeps a credentialless preflight.
Ready PRs run the full affected verification graph and automated review.

Deploy the ready-event compatibility path and server status-context template
before enabling draft preflight. The server change requires a drained rollout;
observe a real ready transition through full CI before changing draft coverage.

`routing.ts` assigns Kubernetes workflows to PR, main, review, or completion
agents. A PR targeting the default branch still uses the PR pool; only a push
or manual run on that branch uses main capacity. Native workflows keep their
host labels. Metadata no-ops use compute capacity, leaving completion available
for required verdicts.

Review and completion use their reserved pools only with the trusted policy
image and no checkout or services. Each requests 250m CPU, 512 MiB memory, and
1 GiB ephemeral storage, so all four slots fit the gate reserve together.
The generator's exported step model includes the dynamic completion workflow
in admission and credential checks.

Signed `pr_draft` state selects draft preflight and admission priority. Main has the highest admission priority;
Kueue preemption remains disabled and production pod priority is unchanged.
Workflow labels carry admission priority through clone, service, and command
pods; each agent fixes its queue label.

Deploy mandatory-label agents and their queues before activating routing.
Before allowing old and new agents to overlap, drain configurations generated
without the shared Paper smoke concurrency cap. Retain the legacy agent until
all unlabelled workflows have finished; then remove it through the normal
declarative release path. Routing labels prevent it from claiming new work.

## Retained task diagnostics

Credentialed verify and browser workflows publish a sanitized JSON artifact to
the private `ci-handoff` bucket after their commands finish, including failures.
Retrieve it using the existing authenticated SeaweedFS AWS profile:

```bash
aws --profile seaweedfs s3 cp s3://ci-handoff/6920/diagnostics-verify.json -
aws --profile seaweedfs s3 cp s3://ci-handoff/6920/diagnostics-playwright-e2e.json -
```

Replace the pipeline number with the run under investigation. Records include
the commit, workflow, invocation timestamps, original exit code, selected browser
packages, and fresh Turbo task hashes, cache results, dependencies and timings.
They exclude raw summaries, commands, logs, input contents and environment values.
Sanitized relative input paths and their hashes are retained for cache audits.
Retries replace that workflow's record; check its timestamp before interpreting
it as evidence for a running retry. Queue and pod startup times remain available
from `toolkit ci explain`; the retained interval begins after toolchain bootstrap
and includes dependency installation. Turbo intervals identify execution within
that interval and can overlap.

Publication uses a 20-second request deadline and bounded retry backoff.
A publication or collection failure fails
an otherwise successful command; an existing command failure keeps its original
exit code. A collection failure publishes metadata with `collectionFailed: true`.
A pod killed before cleanup or an install failure that leaves reporting dependencies
unavailable may have no artifact. Missing diagnostics never mean a cache hit or a
successful run. Credentialless automation does not gain publication credentials.

## Toolchain scopes

Exhaustive verification keeps the complete repository toolchain. Image and
repository automation use the `automation` scope (Bun, GitHub CLI, jq), while
Helm/GitOps publication uses `deployment` (Bun, Node, GitHub CLI, jq, Helm,
ArgoCD, AWS CLI). OpenTofu containers use `tofu` (Bun and OpenTofu). These
profiles resolve the checked-out `.mise.toml` pins even when the base image is
older. Docker/buildx and Git remain prerequisites supplied by that image.
Adding a command to a lane also requires checking its toolchain profile.

## Pipeline authorization

`src/authorization.ts` admits only the owner's named accounts and bots. Justin
publishes owner-requested Tracker work as `justin-principal-engineer[bot]`; both
the PR author and the event sender must be trusted, and fork PRs are refused.
Signed requests from other actors receive HTTP 403 before any forge reads or
workflow generation.

Woodpecker also keeps an independent `approval_allowed_users` list in the
repository's server-side settings. Add the exact bot login there when admitting
it in the extension; retain `require_approval: all_events`. The deployed
extension image must include the authorization change before retrying a parked
bot pipeline. The image delivery path below promotes that reviewed policy.

## Image delivery

The deployed extension image also contains the bundled review poller at
`/app/review-gate.js`. Its `CI_GATE_IMAGE` bootstrap value is the same digest
as the running extension, supplied by the homelab chart. Review and completion
therefore use trusted policy without cloning a PR or installing dependencies.
The poller prints its baked `GIT_SHA` policy revision. Findings, timeouts, and
API errors fail; only the existing unanimous provider-quota exception passes
with an explicit message that no review ran.

Deploy the chart's bootstrap setting before promoting an image that requires
it. Roll back the image and its matching bootstrap value together. Changes to
the review scripts or their code-review dependency select this image for a
rebuild. The persistent Codex auth volume is unused by bundled polling.

The Paper E2E service loads the staged workspace plugin tree directly through
`EXTRA_ARGS=--plugins .../sidecar-plugins` and copies Bukkit configuration through
`COPY_CONFIG_SRC` into `/data`. The preparation step assigns the plugin tree and
shared log directory to Paper's UID/GID 1000 before writing its startup marker.
The runner reads databases and recordings from the same `TheStorm` folder named
by `STORM_E2E_STORM_DATA_DIR`. These paths are part of the service contract; an
empty plugin directory or unreadable shared file is a fixture failure.

The config extension is an application image in `docker-bake.hcl` and
`ci/scripts/images/image-targets.ts`. A main image release builds and smokes its
candidate and registers its immutable artifact. Delivery independently qualifies
the producing pipeline and selects the version in PostgreSQL. Changed extension
code takes effect after that selected image is reconciled and running.

The `image-push` concurrency group serializes image selection and publication.
The image lane enumerates the canonical image recipes and service owners, then
reads their original qualified artifacts from Delivery with the existing CI
publisher identity. Missing originals select fresh builds; authentication,
transport, schema and ownership failures stop the build. Source change selection
uses the extension's whole-successful-pipeline baseline. A completed image step
from a failed pipeline cannot replace that baseline.

No-target and partial builds carry unbuilt artifacts unchanged in the existing
per-pipeline handoff store. Their artifact IDs, producing builds and source
revisions are retained through Delivery's existing `retainedArtifactIds` field.
Fresh candidates identify only outputs built and verified by the current
pipeline. Runtime comparison uses the qualified original digest; Workflow host
versions and routing remain PostgreSQL selections. Git image values and the
retired mutable publication head do not choose reused artifacts.

When a graph change retires a failing lane, the deployed image can still select
that lane for the PR carrying its replacement. Changes under this package are
also inputs to every workflow, so an extension-only PR cannot escape the old
graph. Follow the
[configuration-extension bootstrap procedure](../docs/wiki/src/content/docs/how-to/cut-a-homelab-release.md#bootstrap-a-configuration-extension-graph-change)
to promote the replacement graph through the repository-owned release path.

## Image build caches

Application image releases export final-image cache layers to the registry
with `mode=min`. The persistent BuildKit daemon retains intermediate layers
locally under its existing disk quota and garbage collection policy. This
reduces release-time cache transfers; recovery after losing the local cache
must rebuild intermediate stages. Registry imports remain enabled.

Build progress streams immediately. Only a bounded output tail remains in
memory for transport-failure classification; selectors and manifest queries
retain their complete machine-readable output. Image digest validation,
candidate smoke checks and immutable publication receipts still gate publication.

## Static-site delivery

Browser checks can start alongside verification. Their workflow installs and
builds its own selected Turbo prerequisites with concurrency two in its own
workspace. The required completion verdict and artifact qualification both wait
for verification and browser success. Delivery activates exact qualified
archives from the immutable artifact bucket.

The sites lane builds selected packages through the repository site catalog
and publishes immutable archives without live storage activation, cache purge,
OpenTofu apply, or ArgoCD synchronization. Each site declares its workspace
filter, changed-path inputs, and deploy target; build inputs outside its package
must also be included in those selectors.

Scout publication resolves its backend from actual fresh outputs or original
qualified artifacts retained from Delivery. PR rehearsals use synthetic
print-only input and publish no archive or selected state. A missing real
publication handoff remains a hard failure.

For a new site lane, promote and reconcile the configuration extension image
before enabling its hostname. A pipeline generated by the older image cannot
schedule that lane. Include the site's bucket and routing definitions in its
changed-path inputs so the infrastructure release also publishes its content.

## Pipeline cancellation

Repository auto-cancellation includes `pull_request` only. Main push pipelines
must finish even when another merge arrives: canceling them discards completed
verification and leaves main without a completed verdict during busy periods.
Release admission still supersedes stale deployment work. Woodpecker stores
this repository setting in its database as `cancel_previous_pipeline_events`;
read it back after changing it through the repository API.

## Maintenance lanes

The production inventory enables `woodpecker-maintenance-lanes-enabled`. Main still
waits for exhaustive verification, GitHub releases, npm publication, application
images and charts. Delivery owns deployment. Release-note refinement and CI image refreshes
move to explicit manual workflows. Their failures cannot satisfy or replace
main's verification verdict.

The signed manual request must target the default branch and set
`CI_MAINTENANCE_KIND` to `release-notes`, `ci-images`, or `workspace-seeds`.
The workspace stream has its own default-off Temporal flag. A Temporal dispatcher
also supplies `CI_MAINTENANCE_SOURCE` and a fingerprint. If Woodpecker resolves
a different commit during submission, the extension emits a no-work receipt.
Maintenance runs in the PR pool at draft priority, sharing one concurrency
group across all kinds. It leaves the main and ready-PR reservations intact.

The production inventory also enables the separate
`ci-maintenance-dispatch-enabled` Temporal flag. Both runtime fallbacks remain
off. For a new installation, reconcile the extension image, run both manual
kinds, then unpause `ci-maintenance-dispatch` after the matching Temporal Worker
Deployment is promoted. The schedule is initially paused so
older stable workers cannot receive its new Workflow type. Disable
dispatch first when stopping new work; disable the extension flag to restore
the combined main graph. Already generated pipelines retain their own graph.

Generated release PRs start as drafts. Marking a draft ready requests full CI
and freezes maintenance updates until merge or close. CI image promotion PRs
open ready with squash auto-merge, because every CI step reinstalls a stale
image's missing tools at runtime until the promotion lands; a ready promotion
freezes later candidates the same way.
Publishers re-read draft status and use exact Git head leases before pushing.
The dispatcher retains later candidates and selects the newest verified main
revision after the ready PR closes. Automated review remains required; bot
seat provisioning is independent of lane separation.

Artifact producers consume the release admission verdict before publication.
Superseded releases exit before reading absent handoffs. An admitted producer
still fails on a missing required handoff; there is no deployment pin commit-back.

## Port status

Woodpecker owns verification, images, OpenTofu, Playwright, and releases. The
native macOS lane definitions remain in the repository, but are temporarily
omitted from the generated graph until the Mac agent joins the GUI audit
session (AI-86). A green Woodpecker build during this pause does not include
native macOS verification.
