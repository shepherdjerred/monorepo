# Delivery

Delivery records immutable application artifacts and version sets in PostgreSQL,
selects exact environment versions, and exposes deployment operations through
one authenticated API used by its React UI, toolkit, and Temporal workers.
Woodpecker verifies and publishes artifacts; Temporal executes deployments;
ArgoCD reconciles delegated Kubernetes applications. Git holds source,
infrastructure, and pipeline definitions. Delivery does not commit deployment
state back to Git.

## Contributor commands

Run workspace dependency installation at the repository root. From this package:

```sh
bun run generate
bun run typecheck
bun run test
bun run lint
bun run build
bun run test:e2e
```

Tests start isolated disposable PostgreSQL clusters using the repository's
mise-managed `initdb` and `pg_ctl`. They require no production database or
credentials and do not skip database verification when binaries are missing.
Recovery tests also use the matching `pg_dump` and `pg_restore` tools to restore
an independent cluster and verify request, outbox, evidence, and lock identities.
`bun run migrate:deploy` applies committed Prisma migrations using `DATABASE_URL`.

The API listens on port 7353 by default. `bun run dev` starts its watcher;
`bun run dev:client` runs Vite on port 7354 and proxies API requests to the
backend. The browser requires the same authenticated proxy as production.
The Playwright harness supplies a separate real proxy and disposable database
for local interaction tests.

## Public contracts

`@shepherdjerred/delivery/contract` exports browser-safe Zod schemas and domain
types. `@shepherdjerred/delivery/client` exports `createDeliveryClient` with
injected transport and credentials. Responses are validated before consumption.

The API is rooted at `/api/v1`:

| Operation                                                     | Route                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Authenticated principal                                       | `GET /identity`                                                  |
| Environments, recent executions, eligible artifacts           | `GET /overview`                                                  |
| Immutable version set revisions                               | `GET /versions`, `GET /versions/:id`                             |
| Latest qualified component artifact                           | `GET /artifacts/latest-qualified?serviceId=…&component=…&kind=…` |
| Register pending CI publication                               | `POST /builds`                                                   |
| Compose exact component versions                              | `POST /versions`                                                 |
| Register immutable pipeline revision                          | `POST /pipelines`                                                |
| Register environment/configuration                            | `POST /environments`                                             |
| Request deployment, promotion, or rollback                    | `POST /deployments`                                              |
| Execution, stages, approval, evidence                         | `GET /deployments/:id`                                           |
| Human production approval                                     | `POST /deployments/:id/approval`                                 |
| Cancel or retry                                               | `POST /deployments/:id/cancel`, `POST /deployments/:id/retry`    |
| Independently inspect and recover an ambiguous Argo operation | `POST /deployments/:id/release-lock`                             |
| Retain unverified migration evidence                          | `GET /imports`, `POST /imports`                                  |

Execute-scoped workers use `/qualification/pending`, `/builds/:id/qualify`,
`/reconcile`, `/dispatch/pending`, `/dispatch/monitor`, `/dispatch/:id/submitted`,
and deployment `claim`, `stages`, `finish`, and `orphan` operations. Workflow IDs come from the shared
`deliveryWorkflowId` helper.

CI registration is pending until the backend verifies the exact Woodpecker
main-push pipeline reached success. Artifact selection cannot consume pending
or failed publications. Qualification and initial version set composition commit
atomically; pipeline order prevents a late older build from becoming the newest
automatic selection. New sets retain unchanged components from their base.
The latest-qualified-artifact lookup reads the matching component and kind from
the newest coherent automatic version set, ordered by its qualifying CI pipeline
number in the configured repository. Both the set's qualifying build and the
component's original build must be verified in that repository. It returns the
original artifact and source identity. Manual compositions and late outputs that
never entered an automatic set do not affect this read-only producer lookup;
a missing component in the newest set returns 404 without searching older sets.
Artifact requirements bind dependent components to exact digests; an incompatible
combination fails release qualification with a visible reason. Automatic selection
coalesces only queued, unapproved automatic requests. Cancellation or rejection
suppresses that revision until a new eligible revision or explicit operator request.

The image producer writes `delivery-image-digests` for every candidate it
actually built, pushed, and verified in that pipeline, including candidates
whose runtime fingerprint matches the current deployment. Delivery requires
this handoff and records that candidate's exact digest and CI source. The
legacy `image-digests` and commit-back candidates continue to include only
runtime changes; existing deployment pins are never republished as new builds.
Catalog publication reads no static archive handoffs. The publisher's explicit
`--static-archives` option requires both the sites aggregate and Scout producer
receipts, including exact agreement on Scout artifacts. CI enables that option
only after the separately gated archive publication path is provisioned.

Scout's gated archive producer freezes an independent Delivery release state.
It uses this build's verified candidate image, or reads the latest qualified
Scout image artifact from PostgreSQL for frontend-only builds. Reused images
retain their original artifact, build, and source identities; legacy beta
deployment and tagging retain their existing state. The static producer alone
receives the existing CI credential with read and publish scopes when archive
publication is enabled. It uses the read scope for backend selection; it has no
deployment, execution, administration, or production approval scope.

Import snapshots retain source pins or runtime observations with `verified:
false`. They never create eligible artifacts, accepted deployments, or desired
environment selections.

## Reviewed Arcade registration

The [pipeline definition](registrations/arcade.pipeline.json) binds the published
`chart:arcade` chart and `image:arcade` image to Arcade's `delivery.image` Helm
parameter. Its public health check reaches Arcade through the existing Mario
Kart edge. The [environment definition](registrations/arcade.environment.json)
declares automatic selection; the enabled-environment and write flags, reviewed
Argo ownership transfer, and paused dispatch Schedule still gate activation.
Neither file selects an artifact or records deployment state.

After reviewing the existing inventory, run these explicit registrations from
the repository root with the brokered admin credential:

```sh
toolkit deploy inventory --machine
toolkit deploy pipeline register arcade/1 --file packages/delivery/registrations/arcade.pipeline.json --machine
toolkit deploy environment register --file packages/delivery/registrations/arcade.environment.json --machine
```

The environment command writes configuration. Use it for initial registration
or an explicitly reviewed configuration change; do not rerun it to reset live
settings after a rollback. Pipeline revisions are immutable. A new pipeline
definition requires a new revision ID and a reviewed environment update.

An eligible Arcade version set must contain both components from qualified CI
publications. An unverified import or an image-only first publication cannot
provide the deployment chart. Before enabling automatic selection, verify the
delegated Application, exact chart bytes, running image digests, public health,
and the Arcade user flow.

## Authentication and configuration

Environment variables are bootstrap and credentials: `DATABASE_URL`, `HOST`,
`PORT`, `PUBLIC_ORIGIN`, `ENVIRONMENT`, `WOODPECKER_URL`, `WOODPECKER_REPO_ID`,
`WOODPECKER_TOKEN`, `DELIVERY_MACHINE_CREDENTIALS`, `ARGOCD_SERVER_URL`, and
`ARGOCD_RECOVERY_TOKEN`. The recovery credential is read-only and independent
of Temporal's mutation credential.

Human requests require an allowlisted Tailscale login received from an exact
trusted proxy peer address. The proxy must strip inbound identity headers and
the backend must only admit that proxy and explicitly authorized machine clients.
Browser mutations require the configured origin. Machine credentials carry
server-configured scopes; a publishing credential cannot deploy or execute,
and machine credentials cannot approve production releases. Credential values
are never returned by the identity endpoint.

Typed configuration resolves fresh flag snapshots for `delivery-writes-enabled`,
`delivery-enabled-environments`, `delivery-operator-logins`, and
`delivery-trusted-proxy-addresses`. Defaults deny writes and trust no identities.
Pausing writes stops admission of new effects while allowing cancellation and
recording results of already owned operations. Scout and Starlight production
require human approval bound to the frozen version set, configuration, and
pipeline revision.

## Execution and recovery

Deployment requests, audit events, and outbox submissions commit together.
Idempotency keys bind the request to its authenticated actor and exact inputs.
Claiming work checks the environment generation and acquires a durable target
lock. Different targets execute independently.

Rollback restores the selected accepted deployment's exact pipeline and
configuration as well as its artifacts. Admission still checks the current
environment generation. Promotion retries retain their original source
environment and recheck that it still accepts the selected revision.

Desired, observed, and accepted environment states are separate. Success requires
the exact selected revision plus reconciliation and acceptance evidence.
Failed deployments block automatic successors. An ambiguous external mutation
finishes with `recoveryRequired` and retains its target lock. An administrator
supplies the exact external operation UUID and recovery reason through
`POST /deployments/:id/release-lock`. The API independently reads ArgoCD, verifies
the recorded request, environment delegation, finished operation, and settled
Jobs, and retains that evidence before releasing ownership. This inspection
works while Temporal is unavailable. Canceling running work is a
request to stop at a safe boundary, not an assertion that side effects were undone.

Use `toolkit deploy recover <DEPLOYMENT_ID> --operation-id <ARGO_OPERATION_UUID>
--reason <EXPLANATION> --machine` after inspecting the recorded operation directly.
An active operation, mismatched identity, missing read credential, or specialized
target keeps ownership locked. If no matching finished operation exists, use the
[guarded Delivery recovery procedure](../docs/wiki/src/content/docs/how-to/cut-a-homelab-release.md#recover-a-delivery-operation).
Its brokered export/settle helper rereads the held deployment, applies its frozen
selection through explicit `sync-managed --delivery-selection`, and retains the
actual finished operation requirement for independent unlock. It handles failures
before and after source selection. Stop the prior mutation executor before
settling; a closed Workflow alone does not prove its Activity process stopped.
Do not remove database locks to bypass that check.

Worker rollout routing is tested but registration and deployment admission reject
activation until retained worker versions have PostgreSQL ownership, frozen
environment snapshots, chart rendering, and Temporal drain proofs. Existing
worker rollout ownership remains responsible for those targets. Forum upgrade
admission requires a verified accepted baseline and its frozen prior configuration.

PostgreSQL is the permanent catalog and audit source; Temporal owns durable
execution. Restore PostgreSQL from its declared homelab backups and inspect
outbox/workflow/Argo operation identities before resuming submissions. Recovery
of this control plane must remain possible through the repository's independent
infrastructure tooling.
