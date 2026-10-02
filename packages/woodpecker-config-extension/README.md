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

## Image delivery

The Paper E2E service copies the staged workspace plugins through
`COPY_PLUGINS_SRC` and the staged Bukkit configuration through `COPY_CONFIG_SRC`
into `/data`. The preparation step assigns the shared log directory to Paper's
UID/GID 1000 before writing its startup marker. These paths are part of the
service contract; an empty plugin directory or unreadable shared log is a
fixture failure.

The config extension is an application image in `docker-bake.hcl` and
`ci/scripts/images/image-targets.ts`. A main image release builds and smokes its
candidate, then `version-commit-back` promotes the digest through the version
catalog. ArgoCD must reconcile that new pin before Woodpecker generates
pipelines with changed extension code. The original bootstrap image is not a
substitute for this release path.

## Static-site delivery

The sites lane builds selected packages through the repository deploy catalog
after OpenTofu creates their SeaweedFS buckets. Cloudflare DNS apply waits for
both site publication and ArgoCD reconciliation, so a new hostname has content
and a tunnel route before DNS exposes it. Each site declares its workspace
filter, changed-path inputs, and deploy target; build inputs outside its package
must also be included in those selectors.

## Port status

Woodpecker owns verification, images, OpenTofu, Playwright, and releases. The
native macOS lane definitions remain in the repository, but are temporarily
omitted from the generated graph until the Mac agent joins the GUI audit
session (AI-86). A green Woodpecker build during this pause does not include
native macOS verification.
