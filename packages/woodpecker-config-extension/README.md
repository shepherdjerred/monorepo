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

Shared download caches are paired with explicit tool paths: Bun uses
`/woodpecker/bun-cache/data`, and uv uses `/woodpecker/uv-cache`. The emitter
only supplies a shared path when its declared volume is mounted. Bun's download
cache and its maintenance-lock volume must be mounted together. Installed
dependencies remain private to each workflow workspace.

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

The image baseline includes both a commit and a pipeline number. It requires
successful `images` and `version-commit-back` workflows; the latter can update
a pending pin PR before the catalog on main changes. Before selecting image
targets, the image lane reads that pipeline's required `version-catalog` and
`pin-candidates` handoffs and retains its published internal image pins in the
live main catalog. Newer main pins, upstream versions, metadata and retirements
remain authoritative. Equal release numbers with different digests fail.

Both the no-target path and a partial image build publish the retained catalog
for Helm and the next image baseline. Runtime comparison and Temporal candidate
selection use that same catalog, preserving an active candidate while stable
and candidate differ. An older extension that supplies only a commit provides
no addressable baseline, so the image lane builds all targets during migration.
Once a pipeline number is supplied, a missing handoff is a contract failure.

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

## Port status

Woodpecker owns verification, images, OpenTofu, Playwright, and releases. The
native macOS lane definitions remain in the repository, but are temporarily
omitted from the generated graph until the Mac agent joins the GUI audit
session (AI-86). A green Woodpecker build during this pause does not include
native macOS verification.
