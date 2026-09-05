---
title: Why the CI pipeline has so many steps
description: What each Buildkite lane actually covers, why the step count is not redundancy, and how main builds upload only the steps a commit needs.
sidebar:
  order: 2
---

The main Buildkite pipeline has a lot of steps, and several of them look like
copies of each other. They are not. Each lane exists because it has a different
scope, a different failure meaning, or a different side effect, and collapsing
any two of them would lose information the pipeline is built to preserve.

## The lanes are phases, not duplicated test suites

- **Browser E2E** covers the shipped Playwright consumers: `sjer.red`, the docs
  wiki, the alert dashboard, Scout evals, and Scout's public/docs/app design
  audit. The browser matrix comes from the pinned `ci-playwright` image, so the
  lane is about published sites rather than about Playwright as a tool. The
  design audit uses a deterministic local boot and fixture; see [Run the Scout
  design audit](/how-to/run-scout-design-audit/). The lane's scope statement is asserted in
  [`validate-pipeline-clarity.ts`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/scripts/validate-pipeline-clarity.ts)
  against the lane defined in [`pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml).
- **llm-observability E2E** is the dedicated tracing-stack lane. It starts Tempo
  and MinIO and runs only `@shepherdjerred/llm-observability`'s
  service-dependent tests. That live backing stack is what sets it apart:
  `alert-dashboard-sqlite` also runs integration tests for the alert ledger, but
  against a local SQLite file rather than a service. This lane is the only one
  needing a whole trace pipeline, where a failure means the
  exporter/collector/object-store path broke rather than a query. See the
  `docker-e2e` and `alert-dashboard-sqlite` steps in
  [`pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml).
- **OpenTofu** has one plan and apply job for each SeaweedFS, Tailscale,
  Buildkite, ARR, GitHub, and Cloudflare stack. Each job receives the state
  identity plus only that stack's provider identity. The dependency chain
  preserves release ordering while the job boundary prevents one provider's
  configuration from running with another provider's credential. OpenAI,
  Anthropic, Discord, OpenRouter, and Cloudflare token management add a second
  serialized group: PRs validate them without credentials or a backend, while
  main gives each no-retry job only its platform credential and unique state
  passphrase. Ordinary main builds plan only; an exact-stack
  `TOFU_PLATFORM_APPLY` request selects one job for an operator-controlled
  apply. The
  `tofu-*` steps live in
  [`pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml).
- **Scout** has three deliberate promotion phases: archive and deploy beta, mint
  the immutable tag, then reconcile the production `versions.ts` pin. They are
  three stages of one release, not three independent Scout test suites. The
  `scout-*` steps are ordered in [`pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml).

## Native Apple checks are a separate execution surface

Linux `verify` remains the first hard correctness gate, but it cannot exercise
Xcode, code signing, or macOS UI automation. Changed QuotaBar and TaskNotes
paths therefore add native phases after `verify`: QuotaBar runs its complete
macOS verification suite, while TaskNotes verifies the Rust-to-Swift boundary,
the native app, static analysis, and six signed UI flows.

Those phases target a dedicated `macos` queue and serialize in one global
concurrency group. They do not inherit the Kubernetes plugin, pod metadata, or
cluster-secret environment. This is an intentional trust boundary: affected PR
code runs directly in an unlocked macOS user session, so the host contains only
the development certificate and permissions required by those tests. The host
allows XCTest to enable Automation Mode without authenticating interactively,
so native jobs never depend on an expiring password grant. Release
signing, notarization, iOS simulators, devices, CocoaPods, and Maestro remain
outside that surface.

The native steps are hard on both PRs and `main`, declare bounded timeouts, and
wait for Linux `verify`. Pipeline validation treats native and Kubernetes steps
as different classes so a future edit cannot accidentally route native work to
Linux, attach Kubernetes secrets to the Mac, make the gates soft, or allow the
single host to run them concurrently.

## Optional scans fail differently on purpose

**Trivy** and **Semgrep** are finding scans. Their finding exit statuses are
explicitly soft-failed, while scanner, configuration, and runtime failures stay
hard failures. The exact `soft_fail` exit statuses are pinned in
[`pipeline.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml) and asserted in
[`validate-pipeline-clarity.ts`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/scripts/validate-pipeline-clarity.ts).

That split matters: a soft-failed scanner would silently stop scanning and still
look green. Separating "the scan found something" from "the scan did not run"
keeps the second one a real failure.

## The review gate waits for the exact head

The required PR review gate is Codex. Its latest PR review must name the exact
head commit; a clean review is represented by Codex's 👍 reaction. Unresolved
Codex findings then fold into the gate decision. Qodo remains available as an
optional provider, but is not required by Buildkite for now. The gate is
[`wait-for-review.ts`](https://github.com/shepherdjerred/monorepo/blob/main/scripts/wait-for-review.ts).

Binding to the head commit is the whole point. A review comment from an earlier
push is evidence about code that is no longer proposed, and accepting it would
make the gate approve unreviewed changes.

## Main builds upload only the steps they need

A main build starts from a small selector bootstrap,
[`main-bootstrap.yml`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/main-bootstrap.yml), rather than the
complete graph. [`select-main-pipeline.ts`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/scripts/select-main-pipeline.ts)
compares the commit with the last green main build, uploads only the selected
main steps, and preserves the stable step keys and release dependencies so
downstream lanes still resolve.

Steps that are selected for every main build do not retain a native
`if_changed` filter. Buildkite would otherwise withhold a required dependency
when its path filter does not match. The selector already decides which optional
lanes changed, so those lanes retain their native filters.

Selection-contract, comparison-base, and lane-decision failures upload the
complete main graph instead. The fallback is deliberately the expensive
direction: a broken selector must never be able to skip a lane.

The bootstrap itself is not soft-failed. Invalid configuration, a failure to
load the immutable image pins, and any failure to validate or upload the
complete graph stay hard build failures — a selector that cannot even fall back
correctly is not a degraded optimization, it is a broken build.

## Handoffs stay small, then spill to artifacts

Steps pass values to later steps through Buildkite metadata. Image digests and
pin candidates move to artifacts automatically once they exceed the metadata
budget in [`buildkite-handoff.ts`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/scripts/buildkite-handoff.ts),
and downstream release jobs read either form through
[`read-buildkite-handoff.ts`](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/scripts/read-buildkite-handoff.ts).

The alternative — always using artifacts — would add a download to every handoff
for values that are usually a few hundred bytes.

## Release refinement has its own authentication boundary

The main-only release refiner can use a ChatGPT subscription for Codex without
placing a reusable credential in ordinary CI jobs. Its dedicated pod mounts a
persistent auth bundle that Codex refreshes in place, while the other shared
pod shapes do not mount that storage. The release lane is serialized, so a
single-writer volume is sufficient. The bundle is deliberately excluded from
backups because recovery means reauthenticating on a trusted operator machine.

This separates a renewable login session from an extracted short-lived token.
The distinction lets the release refiner recover normally when its Codex access
token expires without broadening the rest of the Buildkite credential surface.
The [release pod definition](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml),
[PVC declaration](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/argo-applications/ci/buildkite.ts),
and [refiner boundary](https://github.com/shepherdjerred/monorepo/blob/main/scripts/lib/release-refiner.ts)
define that separation.

## Credentials follow issuer and rotation boundaries

Buildkite credentials are stored in 1Password by issuer or rotation unit, not
by an arbitrary target number of Secrets. GitHub, Buildkite API, Buildkite Test
Analytics, Turbo, npm, Claude, ChartMuseum, Argo CD, SeaweedFS, Cloudflare,
Tailscale, and the ARR and tracker services therefore have independent items
and Kubernetes Secrets.
Semantic field names distinguish identities that may initially carry the same
value but must rotate independently later, such as GitHub download, review,
package publication, App, and OpenTofu access.

Every step pod uses the tokenless `buildkite-job` service account without a
RoleBinding and disables service-account token mounting. Only `container-0`
receives credential environment variables. The Buildkite agent, checkout,
init, and sidecar containers receive none, and the job cannot use Kubernetes
RBAC to discover another Secret.

Because the agent process cannot see those container-only values, the
repository `pre-command` hook registers only the grants present in
`container-0` with Buildkite's runtime log redactor before plugins or job code
can emit output. A redactor registration failure stops the job.

`.buildkite/secret-grants.json` is the reviewable contract between step keys,
environment variables, Kubernetes Secrets, and fields. `check-ci-env` compares
the resolved pipeline with that contract and the hashed 1Password snapshot. It
fails on missing or excessive grants, `envFrom`, optional references, blank or
unknown fields, auxiliary-container credentials, the wrong service account, or
an API-token mount. A credential expansion therefore needs an explicit manifest
change that appears in the diff.

The stable field names make later rotations pipeline-independent. The
[Buildkite credential rotation procedure](/how-to/rotate-buildkite-credentials/)
defines the reconciliation, acceptance, and archival checks.

## Related

- [About the monorepo](/explanation/monorepo/) — why CI is Buildkite at all
- [Why releases are shaped this way](/explanation/homelab/release-safety/)
- [Buildkite admission](/explanation/homelab/buildkite-admission/) — where CI runs
