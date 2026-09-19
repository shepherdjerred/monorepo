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

## Port status

`verify` is ported. The images, tofu, playwright, release, and macOS native
lanes are not. Until they are, this service generates a strictly smaller graph
than Buildkite runs and must not be the required status check.
