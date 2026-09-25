---
title: Why the CI pipeline has so many steps
description: What each CI lane actually covers, why the step count is not redundancy, and how a pipeline is generated per commit rather than committed.
sidebar:
  order: 2
---

The CI pipeline has a lot of steps, and several of them look like copies of
each other. They are not. Each lane exists because it has a different scope, a
different failure meaning, or a different side effect, and collapsing any two of
them would lose information the pipeline is built to preserve.

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

A refusal is an error status, never `204`. To Woodpecker a `204` means "keep the
configuration you already have", which is the branch's own committed YAML — the
opposite of a refusal. For the same reason the server runs the extension in
exclusive mode, so there is no committed YAML to fall back to when the extension
fails.

## The lanes are phases, not duplicated test suites

- **Browser E2E** covers the shipped Playwright consumers: `sjer.red`, the docs
  wiki, the alert dashboard, and Scout's public/docs/app design
  audit. The browser matrix comes from the pinned `ci-playwright` image, so the
  lane is about published sites rather than about Playwright as a tool. The
  design audit uses a deterministic local boot and fixture; see [Run the Scout
  design audit](/how-to/run-scout-design-audit/).
- **llm-observability E2E** is the dedicated tracing-stack lane. It starts Tempo
  and MinIO as workflow services and runs only
  `@shepherdjerred/llm-observability`'s service-dependent tests. That live
  backing stack is what sets it apart: `alert-dashboard-sqlite` also runs
  integration tests for the alert ledger, but against a local SQLite file rather
  than a service. This lane is the only one needing a whole trace pipeline,
  where a failure means the exporter/collector/object-store path broke rather
  than a query.
- **OpenTofu** has one plan and apply job for each SeaweedFS, Tailscale, ARR,
  GitHub, and Cloudflare stack. Each job receives the state identity plus only
  that stack's provider identity. The dependency chain preserves release
  ordering while the job boundary prevents one provider's configuration from
  running with another provider's credential. OpenAI, Anthropic, Discord,
  OpenRouter, and Cloudflare token management add a second serialized group: PRs
  validate them without credentials or a backend, while main gives each
  no-retry job only its platform credential and unique state passphrase.
  Ordinary main builds plan only; an exact-stack `TOFU_PLATFORM_APPLY` request
  selects one job for an operator-controlled apply.
- **Scout** has three deliberate promotion phases: archive and deploy beta, mint
  the immutable tag, then reconcile the production `versions.ts` pin. They are
  three stages of one release, not three independent Scout test suites.
- **Toolchain image candidates** rebuild the images other steps run inside:
  `ci-base`, `ci-playwright`, and the two
  [`windows-cross-compiler`](https://github.com/shepherdjerred/monorepo/tree/main/packages/windows-cross-compiler)
  images. Main builds publish a content-addressed candidate and open a pull
  request that moves the committed digest, so a consumer changes toolchains
  only when that pull request's CI passes on the new image. The
  windows-cross-compiler images also run their sample self-tests on pull
  requests, because their consumers do not exercise every compiler they ship.

## Native Apple checks are a separate execution surface

Linux `verify` remains the first hard correctness gate, but it cannot exercise
Xcode, code signing, or macOS UI automation. Changed QuotaBar, hkctl, and
TaskNotes paths therefore add native phases after `verify`.

Those phases select the Mac Mini by its `platform=darwin/arm64` agent label and
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

The required PR review gate is Codex. Its latest PR review must name the exact
head commit; a clean review is represented by Codex's 👍 reaction. Unresolved
Codex findings then fold into the gate decision. Qodo remains available as an
optional provider, but is not required. The gate is
[`wait-for-review.ts`](https://github.com/shepherdjerred/monorepo/blob/main/scripts/review/wait-for-review.ts).

Binding to the head commit is the whole point. A review comment from an earlier
push is evidence about code that is no longer proposed, and accepting it would
make the gate approve unreviewed changes.

## Handoffs go through object storage

Steps pass values to later steps through a build-scoped SeaweedFS prefix,
`s3://ci-handoff/<pipeline number>/<key>.json`, written and read by
[`ci-handoff.ts`](https://github.com/shepherdjerred/monorepo/blob/main/scripts/lib/ci/ci-handoff.ts).

There is one path rather than two. Buildkite offered build metadata for small
values and artifacts for large ones, so every handoff had to choose, and image
digests spilled from one to the other as they grew. Woodpecker has neither, and
one storage path with no size threshold is simpler than reimplementing both.

Reads fail loudly by design. A defaulted `{}` would let a release step deploy
nothing and report success.

The store has its own SeaweedFS identity, scoped to the `ci-handoff` bucket and
nothing else. That is what lets `verify`, `playwright-e2e` and `resume-build`
run on every pull request: they move build values between steps, so they need
this credential, and it cannot touch a published site or the OpenTofu state.
The scope is on the bucket rather than a prefix because the same bucket also
holds `ci-artifact`'s `artifacts/` trees, and a prefix grant would break those
while the handoff half kept working.

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
arbitrary target number of Secrets. GitHub, Turbo, npm, Claude, ChartMuseum,
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

| Field                    | Reaches                                                 |
| ------------------------ | ------------------------------------------------------- |
| `SEAWEEDFS_HANDOFF_*`    | `ci-handoff` only                                       |
| `SEAWEEDFS_SITES_*`      | the thirteen published-site and release-archive buckets |
| `SEAWEEDFS_TOFU_STATE_*` | `homelab-tofu-state` only                               |
| `SEAWEEDFS_APPLE_SDKS_*` | `apple-sdks`, read-only                                 |
| `SEAWEEDFS_TOFU_ADMIN_*` | everything — see below                                  |

`SEAWEEDFS_TOFU_ADMIN_*` is deliberately unscoped: the `seaweedfs` OpenTofu
stack manages the buckets themselves, and SeaweedFS requires unscoped `Admin`
to create one. It is the credential `tofu-plan-seaweedfs` holds, which makes
that step the one pull-request-reachable holder of a broad SeaweedFS key.
Narrowing it means moving bucket management off the pull-request path, not
changing a grant.

The scoping lives in the identities config the S3 gateway loads through
`existingConfigSecret`, which exists only in a 1Password item. No repository
check can see it, so the boundary is proved by probe — each identity must be
**denied** a bucket belonging to another — and that denial is the acceptance
evidence for any change to it. A positive probe alone cannot tell a scoped
identity from an admin one.

Each generated step names the exact secrets and keys it needs, and the agent
turns those into `secretKeyRef` entries with
`WOODPECKER_BACKEND_K8S_ALLOW_NATIVE_SECRETS`. Credentials therefore stay in
1Password-synced Kubernetes Secrets and never enter Woodpecker's own secret
store or its database. Every step pod uses the tokenless `woodpecker-job`
service account without a RoleBinding and disables service-account token
mounting, so a step cannot use Kubernetes RBAC to discover another Secret.

:::caution
Step logs are **not** redacted. Buildkite masked values matching configured
globs and accepted runtime registrations from a `pre-command` hook; Woodpecker
masks only secrets from its own store, and native Kubernetes secrets are
external to it. Keeping credentials in 1Password costs the redactor. Do not echo
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
