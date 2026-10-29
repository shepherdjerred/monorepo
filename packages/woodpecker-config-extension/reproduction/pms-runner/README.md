# PMS component runner

This operator-run program reproduces the existing `media-pms-wire` workflow
through Woodpecker's pinned public compiler, runtime and Kubernetes backend.
It allows testing the component before a deployed configuration extension can
emit that lane. It does not create a Woodpecker server result, replace exact-head
CI, or establish production Plex acceptance.

## Contributor checks

From the repository root:

```sh
bun run --cwd packages/woodpecker-config-extension test:pms-runner
bun run --cwd packages/woodpecker-config-extension test:ci
```

The local `test` script runs Vitest followed by the same Go race tests. The CI
manifest keeps its Vitest step and separately executes
`go -C reproduction/pms-runner test -race ./...` from the extension workspace.
Use the repository-pinned Go toolchain and committed `go.mod`/`go.sum`.

Go tests use fake backends, resource maps and Kubernetes clientsets. The compiler
contract test invokes Bun and the actual TypeScript emitter from the installed
workspace, then compiles that workflow through the pinned public compiler. They never
invoke the live-client constructor, load kubeconfig or launch a workload. Their
coverage includes partial setup, uncertain ownership, UID replacement, durable
ledger restart, cleanup failures and the exact admitted image-pull references.

## Exact-source command reference

Run from a clean repository checkout at the full pushed source SHA. Set these
non-secret variables before the commands below:

- `PMS_SOURCE`: the exact 40-character source SHA at the remote branch head.
- `PMS_BRANCH`: that branch name.
- `PMS_REQUEST_ID`: a fresh lowercase UUIDv4, never reused for another run.
- `PMS_ARTIFACTS`: a new absolute private artifact directory outside the checkout;
  it must not already exist. Preserve this directory for cleanup recovery.

Render the actual workflow and strict plan:

```sh
bun packages/woodpecker-config-extension/src/reproduction/render-media-pms.ts \
  "$PMS_SOURCE" "$PMS_BRANCH" "$PMS_REQUEST_ID" "$PMS_ARTIFACTS"
shasum -a 256 "$PMS_ARTIFACTS/plan.json"
```

The renderer checks the clean checkout, repository origin and exact pushed
branch head. Review both generated files, including all images, commands,
resources and policy. Set `PMS_PLAN_SHA256` to the first field of the displayed
plan-file checksum. This is the hash of the literal `plan.json` bytes, not the
YAML hash recorded inside it. Build from the same clean source:

```sh
go -C packages/woodpecker-config-extension/reproduction/pms-runner build \
  -mod=readonly -trimpath \
  -ldflags "-X main.runnerSource=$PMS_SOURCE -X main.reviewedPlanSHA256=$PMS_PLAN_SHA256" \
  -o "$PMS_ARTIFACTS/pms-runner" .
```

The binary accepts only its compiled-in source and plan digest, then verifies
the YAML digest and compiled command/placement policy. The shared
`protocol.schema.json` is validated by both TypeScript and Go. An altered plan
requires a new review and matching build.

The standalone workflow admits only manual events. Its YAML retains Woodpecker
dollar escaping; the plan records the exact commands after that substitution.

Only launch after reviewing the exact artifacts and obtaining the intended
operator execution window. Run outside Kubernetes with existing operator
kubeconfig; do not copy its credentials into the workspace or step pods.
Ambient `WOODPECKER_` overrides are refused. The resource ledger must be new:

```sh
"$PMS_ARTIFACTS/pms-runner" run \
  "$PMS_ARTIFACTS/plan.json" "$PMS_ARTIFACTS/media-pms-wire.yaml" \
  "$PMS_ARTIFACTS/resources.jsonl"
```

Recover cleanup with the same reviewed binary, plan, YAML and existing ledger:

```sh
"$PMS_ARTIFACTS/pms-runner" cleanup \
  "$PMS_ARTIFACTS/plan.json" "$PMS_ARTIFACTS/media-pms-wire.yaml" \
  "$PMS_ARTIFACTS/resources.jsonl"
```

`cleanup` does not execute workflow commands. Keep the private ledger and
bounded sanitized output when a run fails; a cleanup failure is a failed run.
Do not retry `run` with a new ledger against existing resources.

## Ownership and credential boundary

The plan fixes all three pod names, the headless service and the workspace PVC
before creation. Exact names must be absent, shared cache UIDs are recorded,
and the exclusive-create ledger fsyncs intents before setup. Observed ownership
requires the reviewed object shape and a durably recorded UID. A create conflict
or uncertain readback grants no cleanup ownership.

Deletion uses exact names and UID preconditions, verifies absence and refuses
replacements. All owned pods must be absent before workspace deletion. Shared
cache PVCs are never deletion candidates. Never substitute name-only deletion,
label-wide cleanup or removal of an unverified UID for this refusal.

The runner retains the existing default Kueue queue, liskov placement,
`batch-low` priority and tokenless `woodpecker-job` service account. The plan
pins the account's existing `dockerhub-pull-woodpecker-ci` image-pull reference;
preflight validates the account and readback requires the same admitted pod
references. These references authorize kubelet pulls, not mounted application
credentials. Native secrets, credential environment sources and unreviewed
volumes remain refused.
