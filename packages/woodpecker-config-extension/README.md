# woodpecker-config-extension

Generates this repository's CI pipeline for each Woodpecker build.

Woodpecker calls a [configuration extension](https://woodpecker-ci.org/docs/usage/extensions/configuration-extension)
instead of reading committed workflow YAML. It posts the repository, the
pipeline, and the list of changed files; this service replies with the
workflows that build should run. That is what replaces Buildkite's
`pipeline upload` — lane selection happens here rather than in a bootstrap pod,
so no step has to start before the graph is known.

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

Source caching is controlled by the typed `woodpecker-source-cache-enabled`
flag (default off). Branches under `ci-canary/` have beta targeting. The
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

Shared download caches are paired with explicit tool paths: Bun uses
`/woodpecker/bun-cache/data`, and uv uses `/woodpecker/uv-cache`. The emitter
only supplies a shared path when its declared volume is mounted. Bun's download
cache and its maintenance-lock volume must be mounted together. Installed
dependencies remain private to each workflow workspace.

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
They exclude raw summaries, commands, logs, inputs and environment values.
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
publishes owner-requested Linear work as `justin-principal-engineer[bot]`; both
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
candidate, then `version-commit-back` promotes the digest through the version
catalog. ArgoCD must reconcile that new pin before Woodpecker generates
pipelines with changed extension code. The original bootstrap image is not a
substitute for this release path.

The `image-push` concurrency group serializes image selection and publication.
Before selecting targets, the image lane reads the latest publication from
`ci-handoff/published-images/main.json`. A successful push, including a
no-target run, atomically records its commit, pipeline number and both catalog
and candidate handoffs there. Queued pipelines therefore see images published
while they were waiting, even while pin commit-back remains pending.

The publication reader starts with the build's exact source catalog. Upstream
versions, entry membership and metadata stay paired with that checkout's
checksums and configuration. Only internal image values advance from live main
and completed publications; reviewed candidate withdrawals are validated against
live main before retention. Equal release numbers with different digests fail.
An older or conflicting publication cannot overwrite a newer record.
Recover an already published image pipeline with a new full manual main run;
do not reuse its release number for different artifacts.

Both the no-target path and a partial image build publish the retained catalog
for Helm and the next image baseline. Runtime comparison and Temporal candidate
selection use that same catalog, preserving an active candidate while stable
and candidate differ. Before the first publication record exists, the lane
bootstraps from the extension's commit and pipeline baseline, which requires
successful `images` and `version-commit-back` workflows. A legacy commit without
a pipeline number provides no addressable baseline and selects all targets.
Invalid publication records and missing required handoffs fail the build.

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
candidate smoke checks and pin promotion still gate publication.

## Static-site delivery

Browser checks can start alongside verification. Their workflow installs and
builds its own selected Turbo prerequisites with concurrency two in its own
workspace. The required completion verdict and site deployment both wait for
verification and browser success. Site deployment consumes the exact tested
artifact from the pipeline handoff bucket.

The sites lane builds selected packages through the repository deploy catalog
after OpenTofu creates their SeaweedFS buckets. Cloudflare DNS apply waits for
both site publication and ArgoCD reconciliation, so a new hostname has content
and a tunnel route before DNS exposes it. Each site declares its workspace
filter, changed-path inputs, and deploy target; build inputs outside its package
must also be included in those selectors.

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

`woodpecker-maintenance-lanes-enabled` defaults off. When enabled, main still
waits for exhaustive verification, GitHub releases, npm publication, application
images, charts, and deployment. Release-note refinement and CI image refreshes
move to explicit manual workflows. Their failures cannot satisfy or replace
main's verification verdict.

The signed manual request must target the default branch and set
`CI_MAINTENANCE_KIND` to `release-notes` or `ci-images`. A Temporal dispatcher
also supplies `CI_MAINTENANCE_SOURCE` and a fingerprint. If Woodpecker resolves
a different commit during submission, the extension emits a no-work receipt.
Maintenance runs in the PR pool at draft priority, sharing one concurrency
group across both kinds. It leaves the main and ready-PR reservations intact.

The separate `ci-maintenance-dispatch-enabled` Temporal flag defaults off.
The extension flag's beta segment permits explicit signed maintenance canaries while ordinary
main pipelines retain the combined graph. Reconcile the new extension image,
run both manual kinds, then enable the extension flag for production and
enable dispatch and unpause `ci-maintenance-dispatch` after the matching
Temporal Worker Deployment is promoted. The schedule is initially paused so
older stable workers cannot receive its new Workflow type. Disable
dispatch first when stopping new work; disable the extension flag to restore
the combined main graph. Already generated pipelines retain their own graph.

Generated release and image promotion PRs start as drafts. Marking a draft
ready requests full CI and freezes maintenance updates until merge or close.
Publishers re-read draft status and use exact Git head leases before pushing.
The dispatcher retains later candidates and selects the newest verified main
revision after the ready PR closes. Automated review remains required; bot
seat provisioning is independent of lane separation.

Scout release and image pin commit-back steps consume the same release
admission verdict as their artifact producers. Superseded releases exit before
reading absent handoffs or mutating state. An admitted release still fails on
a missing required handoff.

## Port status

Woodpecker owns verification, images, OpenTofu, Playwright, and releases. The
native macOS lane definitions remain in the repository, but are temporarily
omitted from the generated graph until the Mac agent joins the GUI audit
session (AI-86). A green Woodpecker build during this pause does not include
native macOS verification.
