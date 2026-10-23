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

The hosted API keeps its existing pod serving while one replacement runs
migrations and becomes ready. Executors need this journal during the API's own
release. Schema migrations must therefore remain compatible with the serving
revision until its replacement passes readiness.

The API listens on port 7353 by default. `bun run dev` starts its watcher;
`bun run dev:client` runs Vite on port 7354 and proxies API requests to the
backend. The browser requires the same authenticated proxy as production.
The Playwright harness supplies a separate real proxy and disposable database
for local interaction tests: `e2e/server.ts` on port 17353 for the release
specs, and `e2e/model-server.ts` on port 17355 for `model.spec.ts`. The model
harness reconciles its own catalog and records Arcade's releases, a
configuration rebind, monitor observations, a restore hold and a quarantined
deploy through Delivery's own APIs (`e2e/model.ts`), plus a tofu stack waiting
at its approve step and archives for an operator-run stack and a channel
(`e2e/model-plan.ts`), so its pages read the real model routes. Setting
`DELIVERY_HARNESS_MACHINE_CREDENTIALS` to a JSON array of disposable machine
credentials lets a client drive the admin and execute routes; the proxy then
passes their bearer tokens through. `src/testing/model-fixtures.ts` holds
contract-validated route responses for unit tests of the hub views and the
toolkit.

## Browser hub

The React client is the homelab's CI/CD hub. Every page has a URL, so links,
history, new tabs and bookmarks behave like any website. Routes are code-based
TanStack Router definitions in `src/client/router.tsx`:

| URL                            | Page                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| `/pipelines` (home)            | Every pipeline's newest execution, attention items, tools    |
| `/pipelines/:id`               | Promotion: source, build, test, version set, environments    |
| `/pipelines/:id/executions`    | Every build or composed version set and where it deployed    |
| `/builds/:id`, `/versions/:id` | One change end to end, with commit, CI run and artifacts     |
| `/deployments/:id`             | Steps, selection, approval, a tofu plan waiting for approval |
| `/environments/:id`            | Restore hold, selection, monitor, rollback candidates, form  |
| `/recovery-intents/:id`        | One unified recovery intent and its inspection evidence      |
| `/deployments`, `/approvals`   | Deployment history; waiting and recently decided approvals   |
| `/artifacts`, `/activity`      | Build qualification; the audit trail with catalog reconciles |

Filters and pages are search parameters. Forms are native `<form>` elements
and confirmations are native `<dialog>` elements. The server returns
`index.html` for every non-API path.

`GET /api/v1/events` is a Server-Sent Events stream of committed changes. An
`Audit` insert trigger issues `pg_notify`, so an event is published only after
its transaction commits. The browser refetches the visible queries the change
can affect. After a reconnect it refetches everything, because the stream does
not replay. While the stream is down, visible queries poll every 30 seconds.

Commit, CI and runtime panels read Woodpecker, GitHub and ArgoCD on request.
Finished pipelines and merged commits are cached in `IntegrationSnapshot`
permanently; running pipelines and unmerged commits are refreshed after a short
TTL; ArgoCD state is only memoized for seconds. A disabled, unconfigured or
failing integration degrades its own panel and still links to the tool.

## Public contracts

`@shepherdjerred/delivery/contract` exports browser-safe Zod schemas and domain
types. `@shepherdjerred/delivery/client` exports `createDeliveryClient` with
injected transport and credentials. Responses are validated before consumption.

### Contracts for the model

`@shepherdjerred/delivery/model-contract` (`src/shared/model/`) carries the
schemas for the Delivery model specification (`docs/model.md`). The record,
the routes, the executor, the hub and the toolkit read them. The hub and
toolkit call the model routes through `createDeliveryClient`, whose model
methods (`src/shared/model/routes-client.ts`) validate each request body
before sending and each response before use.

- Catalog (4.1): `CatalogDocumentSchema` types every recipe body of the
  ops-model document and checks that a recipe binds only components of its own
  service and runners the catalog declares (P3, A5) and that each target
  instance is named by one environment (T6). `catalogRevision` is the
  `sha256:` fingerprint over `canonicalJson` of the parsed document that a
  deployment freezes; `serviceLineage` is the hex sha256 of a service's sorted
  component names (S1, R5). The structure itself is the language-neutral
  `@shepherdjerred/ops-model/catalog-document.schema.json`, mirrored by
  `@shepherdjerred/ops-model/catalog-document-shape.ts` and refined by
  `@shepherdjerred/ops-model/catalog-document.ts`.
- Recipe (4.7, section 5): `RecipeDefinitionSchema` discriminates on `kind`:
  `kubernetes-application` (full Application body, `chartComponent`,
  `artifactParameters`, a `runner` component reference, ordered `steps` with
  `pointOfNoReturn`, optional `sharedLock`, and an `oracle` of probes, tests
  and monitor), `static-site`, `tofu` (plan, approve, apply steps under the
  `platform` lock), `channel`, `operator-run` and `compound`. An
  `operator-run` recipe wraps a `kubernetes-application` or `tofu` recipe, or
  stands on its own around a `host` target (`model/operator-run-contract.ts`):
  a `host:<name>` lock instance and the image components a by-hand upgrade
  moves, as for `cluster-nodes`. Its bindings (components, instances,
  runners) are in `model/recipe-bindings.ts`.
  `recipeFromPipeline` (`model/recipe-adapter.ts`) maps a v1 `PipelineDefinition`
  onto a recipe: runner digests become the `ci` service's `image:ci-base`
  reference, `site:` archives become `archive:`, fixed v1 blocks become
  steps, and Helm `parameters` are refused because they are configuration
  (P4).
- Monitor (4.19): `MonitorSchema` (image component, alarm matchers with an
  `environment` label, evidence thresholds, `automatic` or `hold` policy;
  queries may use only `$window`, `$version` and `$gitSha`),
  `MonitorObservationInputSchema`, `MonitorObservationSchema`,
  `WatchingMonitorSchema`, `MonitorStatusSchema`, and the pure
  `renderMonitorQuery` and `monitorOutcome` helpers.
- Selection (4.9, D9): `SelectionSchema` and `RollbackCandidatesSchema`.
- Route views (`model/route-contract.ts`): the environment's accepted
  selection beside its declared binding, `DeploymentV2Schema` with its frozen
  selection, previous accepted and restored deployments, the approval queue
  item, the recovery-intent and attestation requests, the catalog reconcile
  result and state, the record each catalog reconcile audits, service
  retirement, the restore-hold settlement, and the reconcile-after-restore
  comparison. `MonitorStatusSchema` carries the declared monitor and the
  latest observation so evidence reads against its threshold. The selection
  view names the declared recipe's kind, and the hub's environment detail
  names the release kind: that of the recipe a release freezes, the accepted
  selection's until a rebind. An `operator-run` recipe is requested as one.
- Cold start (section 6, X7): `ColdStartSnapshotSchema` records each
  environment's accepted selection with its set revision's artifacts, and
  `COLD_START_SNAPSHOT` names the R2 endpoint and object the snapshot writer
  puts and `toolkit deploy snapshot` reads. `renderApplication`
  (`model/application-render.ts`) is the one rendering of a
  `kubernetes-application` recipe into its ArgoCD Application for one
  environment's selection; the executor writes it, and
  `toolkit deploy render-application` prints it with the sync a cold start
  needs.
- Deployment and approval (4.12, 4.13): `CreateDeploymentV2Schema` with
  `deploy`, `promote`, `rollback` (naming `selectionDeploymentId`), `rebind`,
  `retire-host`, `channel-publish` and `operator-run`, plus the `override`
  marker; `ApprovalStatusSchema` and `ApprovalV2Schema` with `override`.
- Recovery (4.15): `RecoveryIntentV2Schema`, one intent shape keyed by
  deployment and sequence with a `kind` for each v1 recovery path.
- Evidence: `EvidenceInputSchema` in `contract` accepts the `monitor`,
  `alarm`, `test`, `drift` and `attestation` kinds beside the v1 kinds.

The API is rooted at `/api/v1`:

| Operation                                                       | Route                                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Authenticated principal                                         | `GET /identity`                                                               |
| Environments, recent executions, eligible artifacts             | `GET /overview`                                                               |
| Immutable version set revisions                                 | `GET /versions`, `GET /versions/:id`                                          |
| Latest qualified component artifact                             | `GET /artifacts/latest-qualified?serviceId=…&component=…&kind=…`              |
| Producer comparison base, pending or qualified                  | `GET /artifacts/latest-retainable?…&kind=…&beforePipeline=…`                  |
| Register pending CI publication                                 | `POST /builds`                                                                |
| Compose exact component versions                                | `POST /versions`                                                              |
| Register immutable pipeline revision                            | `POST /pipelines`                                                             |
| Register environment/configuration                              | `POST /environments`                                                          |
| Request deployment, promotion, or rollback                      | `POST /deployments`                                                           |
| Execution, stages, approval, evidence                           | `GET /deployments/:id`                                                        |
| Human production approval                                       | `POST /deployments/:id/approval`                                              |
| Human approval or rejection of a tofu recipe's exact saved plan | `POST /deployments/:id/plan-approval`                                         |
| Cancel or retry                                                 | `POST /deployments/:id/cancel`, `POST /deployments/:id/retry`                 |
| Open a recovery intent; settle an ambiguous Argo operation      | `POST /deployments/:id/recovery-intents`, `POST /recovery-intents/:id/settle` |
| Request native site/Forum recovery under the retained lock      | `POST /deployments/:id/content-recovery`                                      |
| Inspect frozen content recovery and native receipts             | `GET /content-recovery/:id`                                                   |
| Hub, service pipeline and paginated executions                  | `GET /hub`, `GET /services/:id/pipeline`, `…/executions`                      |
| One change, traced from build or version set                    | `GET /builds/:id`, `GET /versions/:id/trace`                                  |
| Paginated deployments, builds and audit activity                | `GET /deployments`, `GET /builds`, `GET /activity`                            |
| Environment detail and approval queue                           | `GET /environments/:id`, `GET /approvals`                                     |
| Woodpecker, GitHub and ArgoCD enrichment                        | `GET /builds/:id/ci`, `…/source`, `GET /environments/:id/runtime`             |
| Committed change stream                                         | `GET /events`                                                                 |

Execute-scoped workers use `/qualification/pending`, `/builds/:id/qualify`,
`/replication/pending`, `/artifacts/replication`, `/reconcile`, `/dispatch/pending`, `/dispatch/monitor`, `/dispatch/:id/submitted`,
and deployment `claim`, `stages`, `finish`, and `orphan` operations. Workflow IDs come from the shared
`deliveryWorkflowId` helper.

The independent control-plane stage appends immutable evidence for native Job
admission, its dispatch journal, replay, and final acceptance. Exact proof replays
reuse existing records, including older indexed receipts. Stage operation identity
and completed-stage immutability remain mandatory; other stages retain indexed
evidence identities. Frozen Minecraft upgrade pipelines also append preservation
proofs under their numbered preservation stage, retaining the initial native
controller receipt when the independent backup and gameplay proofs arrive.

The TSMC pipeline declares `minecraftUpgrade.releaseMode` in its immutable
registration. `retained-volume-restart` uses an ordinary graceful StatefulSet
restart on the retained world PVC and requires the usual exact source, image,
reconciliation and runtime acceptance. It does not manufacture preservation
evidence or couple every release to a cloud backup and restored candidate.
`verified-restore` and existing revisions with no mode retain the independent
backup/restore gate. Unknown modes fail validation. Neither mode permits an
image-only rollback of the persistent world.
Routine-mode reconciliation failures use the ordinary independent Argo recovery
inspector, which requires the same recorded request, native operation identity
and settled external work before releasing ownership. Legacy preservation
recovery still requires its private controller journal.

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

Producers compare against the latest-retainable lookup instead, so a pipeline
that starts before the previous one qualifies still retains that pipeline's
unchanged images and charts by reference (B2). It returns the component of the
newest pending or verified CI build in the configured repository whose pipeline
is above the order key of the current lineage's live set and below the
producer's `beforePipeline`, or else the live set's entry. A set the catalog
migration carried is a qualified base. Failed builds, builds that reach a
failed build through their pending references, and builds the live set
supersedes (R4) are never a base. Registration accepts a retained original
whose build is still pending only from an earlier main pipeline of the same
repository. Qualification keeps the retaining build pending until that build
verifies. A failed reference fails the retaining build with a reason naming the
artifact, and the next pipeline rebuilds. A platform source's root chart and
site references gate it the same way, including producers registered before it
in the same pipeline. Only a build that precedes the waiting build in the order
key (pipeline, then registration sequence) is awaited; any other pending
reference fails qualification, so no build waits on itself or on a later
build.

The image producer writes `delivery-image-digests` for every candidate it
built, pushed, verified and found changed by runtime fingerprint, and
`delivery-retained-image-artifacts` for every retainable original it kept:
images it did not build and candidates whose fingerprint equals the original.
Delivery requires both handoffs; a retained original is referenced by its
existing artifact id and never republished as a new build. The runtime
fingerprint excludes the `VERSION` and `GIT_SHA` build arguments, so a retained
image keeps the original build's `VERSION` and `GIT_SHA`. That `GIT_SHA` is the
artifact's `sourceRevision`, and the worker pool stamps
`TEMPORAL_WORKER_BUILD_ID` from the same value, never from the pipeline number.

The publisher requires the TRMNL archive producer's handoff even when it is
empty. Its `--static-archives` option also requires the sites aggregate and
Scout producer receipts, including exact agreement on Scout artifacts. CI always produces immutable archives; API
registration waits only for the catalog endpoint's bootstrap.

Scout's archive producer freezes an independent Delivery release state.
It uses this build's verified candidate image, or reads the latest qualified
Scout image artifact from PostgreSQL for frontend-only builds. Reused images
retain their original artifact, build, and source identities. The static producer
receives a dedicated CI credential with read and publish scopes. It uses the
read scope for backend selection; it has no
deployment, execution, administration, or production approval scope.

Import snapshots retain source pins or runtime observations with `verified:
false`. They never create eligible artifacts, accepted deployments, or desired
environment selections.

## Reviewed registrations

The registration catalog covers ordinary applications, static sites, and
specialized releases. [Ordinary definitions](registrations/ordinary),
[static-site definitions](registrations/static), and
[specialized definitions](registrations/specialized) declare their artifact
components, execution adapter, verification and approval policy. The homelab's
`delivery-target-policy.ts` checks the complete Application inventory against
these release boundaries. Infrastructure remains subject to `release-root`'s
guarded orchestration.

Registration does not transfer ownership. The reviewed service catalog's
`deliveryDelegations` map controls the Argo Application ownership boundary.
The retired pin writer has no deployment or Git mutation implementation.
Ownership transfers only after the previous release automation is stopped.
Build-scoped image metadata remains complete so chart packaging retains its
verified dependencies. No selected release version is recorded in that map.

Scout's backend and frontend share one environment, version set, deployment,
target lock and acceptance result for each stage. Its `scoutSite` policy binds
the frontend archive to the exact backend image digest. The executor first
verifies the backend's reconciled runtime and worker rollout, then activates
and verifies that archive. The release is accepted only after both succeed.
Production approval covers this complete frozen selection once; the frontend
cannot accept independently or bypass the backend's compatibility checks.
Frontend-only builds retain the original qualified backend artifact. A failed
site activation leaves the combined release unaccepted and subject to the
same recovery ownership as its backend mutation.

Scout beta and production each use one combined backend and frontend release.
The pipeline's frozen `scoutSite` policy selects its matching archive flavor,
which must require the selected backend image digest. The backend Application
lock and production approval cover both artifacts: execution verifies the backend
runtime, activates and verifies the exact frontend archive, then records one
accepted release. A separate Scout static environment cannot activate the site.
Host-only worker adoption and worker retirement do not publish frontend bytes.

Arcade provides the small initial acceptance example:

The [pipeline definition](registrations/arcade.pipeline.json) binds the published
`chart:arcade` chart and `image:arcade` image to Arcade's `delivery.image` Helm
parameter. Pipeline revision `arcade/2` probes Arcade's canonical public health
endpoint. The [environment definition](registrations/arcade.environment.json)
declares automatic selection; its catalog lifecycle, the write flag, reviewed
Argo ownership transfer, and paused dispatch Schedule still gate activation.
Neither file selects an artifact or records deployment state.

Delivery API pipeline revision `delivery/2` verifies `/healthz` through its
in-cluster Service, which is reachable by the owning activity role. Register the
new immutable pipeline revision and its environment binding; preserve `delivery/1`
and the existing configuration revision for historical requests.

After reviewing the existing inventory, run these explicit registrations from
the repository root with the brokered admin credential:

```sh
toolkit deploy inventory --machine
toolkit deploy pipeline register arcade/2 --file packages/delivery/registrations/arcade.pipeline.json --machine
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
`WOODPECKER_TOKEN`, `DELIVERY_MACHINE_CREDENTIALS`, `ARGOCD_SERVER_URL`,
`ARGOCD_RECOVERY_TOKEN`, and the optional read-only `DELIVERY_GH_TOKEN`.
`ARGOCD_RECOVERY_TOKEN` is a read-only ArgoCD credential for the hub's runtime
panel only; no settlement reader uses it. The API holds no R2 credential:
`POST /api/v1/reconcile-after-restore` takes the cold-start snapshot, its
writer's `fingerprint` metadata and its immutable copy's key from the operator,
who reads `latest.json` and that copy with their own credential
(`restoreRequest` in the model contract). The API checks the fingerprint and
the key before comparing.

ArgoCD declares three separate API accounts: `delivery` may select and sync the
reviewed workload Applications; `delivery-observer` can only read their state;
`delivery-platform` owns the guarded root release and isolated control-plane
Application. Root child synchronization is limited to the reviewed root-owned
inventory. These accounts receive no default role, wildcard targets, resource
editing, logs, or exec permission. The former Woodpecker account is disabled.
Apply the reviewed account registration before issuing credentials through the
operator-owned `packages/homelab/src/tofu/argocd` stack. Its
`delivery_platform_onepassword_item_id` output supplies the typed
`platformArgocdItemId` activation field, paired with the platform registry item.
The isolated Jobs use the fixed `delivery-platform-argocd` Secret; the broad
legacy root token is not a substitute. Declaring this source does not issue a
token or transfer live ownership.

The operator-owned ArgoCD plan also retires only the former
`argocd_account_token.woodpecker` and
`onepassword_item.argocd_woodpecker_token` resources; their obsolete rename
blocks and output are removed. Inspect those destruction targets before apply.
Complete the first Woodpecker-only bootstrap using the existing legacy root
credential, register the scoped accounts, then issue their tokens and revoke
that retired token/item. Subsequent API/control-plane bootstrap root operations
use the newly issued `delivery-platform` credential. The separate operator
admin credential is used only for the preownership account prerequisite, never
as a runtime or ownership-handover fallback.

`toolkit deploy handover-context --machine` is an admin-only read of the API's
baked source identity, each environment's binding in the catalog as last
reconciled into PostgreSQL together with that reconciled `catalogRevision`
(the handover refuses unless it is the reviewed revision its descriptor
names), fresh write-admission state, the environments whose
catalog lifecycle is `active` and so admit deployments, and uncapped PostgreSQL
ownership/request/recovery counts. It refuses before any catalog reconciliation
and after a definition was registered outside the catalog since then. The bounded
`packages/homelab/scripts/ci/delivery-handover.ts` operator command consumes that
state and the exact reviewed source proof, independently checks the paused
Woodpecker webhook and drained native pipelines, then transfers only the
registered Applications' ownership annotation and disables their auto-sync.
Each UID/resource-version CAS preserves the complete native source, parameters,
destination and unrelated metadata; external private receipts record intent and
readback. Worker/Forum targets require their genuine independent original
baselines. Ordinary targets acquire no fabricated accepted version set.

The command resolves newly issued `delivery` and `delivery-platform` credentials
from their reviewed activation item references and verifies their native
identities/capabilities before effects. It never falls back to an operator admin
token. Keep root sync, dispatch and write admission paused throughout this
maintenance window: PostgreSQL and ArgoCD do not share an atomic transaction.
After native authority transfer, the first release establishes real acceptance.
The first controller intent names the qualified original bootstrap image/chart;
its native prior selection necessarily contains the explicit image parameter,
without implying any earlier PostgreSQL acceptance.

Static producers require their dedicated
`DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID` and
`DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY`; missing credentials fail before
starting an S3 operation. That identity can access only `delivery-artifacts`.
The executor uses distinct `DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID` and
`DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY` credentials to read archives and
mutate the reviewed website bucket allowlist. S3 write permission includes
deletion; immutable archive checks do not imply an append-only storage policy.
The allowlist lives in the homelab's `delivery-storage-policy.json` and is
checked against every static registration.

Cache invalidation uses a dedicated Cloudflare user token with Cache Purge
permission on the registrations' exact zones. The existing encrypted
`cloudflare-tokens` OpenTofu stack owns issuance and its 1Password handoff.
Static executor bootstrap requires both storage and cache credentials;
publication and site ownership stay disabled until their actual permissions
and archive readback have been verified.

Human requests require an allowlisted Tailscale login from the existing
operator's fixed `delivery/delivery-operator-ingress`. The pinned operator strips
inbound identity headers and supplies the authenticated login. For each human
request, the API verifies its exact socket peer against fresh Kubernetes reads:
the current Ingress UID, exact managed parent labels, ready nonterminating proxy
Pod IP, and its current StatefulSet controller UID, labels and selector in the
`tailscale` namespace. It repeats those observations before trusting the peer.
Unknown, stale, duplicate or reused IP identities fail closed. The API's
short-lived projected identity can only get that Ingress, list proxy-namespace
Pods and get their StatefulSets; no Secret access or workload writes are granted.
Kubernetes verification failure blocks human authentication with a useful
boundary error. There is no static IP, Pod CIDR or namespace-only trust fallback.
Browser mutations require the configured origin. Machine credentials carry
server-configured scopes; a publishing credential cannot deploy or execute,
and machine credentials cannot approve production releases. Bearer authentication
does not read Kubernetes or inherit proxy identity. Credential values are never
returned by the identity endpoint. Health checks also require no Kubernetes access.

Typed configuration resolves fresh flag snapshots for `delivery-writes-enabled`,
`delivery-operator-logins` and `delivery-enrichment-sources`. Admission and the
ownership handover read the catalog lifecycle, never
`delivery-enabled-environments`; that flag is v1's enable list. Defaults deny writes, authorize no human logins
and query no external integration. The enrichment flag is a JSON list drawn
from `woodpecker`, `github` and `argocd`. The GitHub token is registered as the
`githubReader` 1Password item in the homelab Delivery activation, with a
`DELIVERY_GH_TOKEN` field holding a fine-grained token that can read the
monorepo's contents and pull requests. Proxy trust is verified native ownership,
not a feature flag.
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
opens a recovery intent through `POST /deployments/:id/recovery-intents`, then
settles an `argo` intent with the exact external operation UUID and reason
through `POST /recovery-intents/:id/settle`; no route releases a lock without an
intent. The API independently reads the Application
object, verifies the recorded request, environment delegation, finished operation,
and settled Jobs, and retains that evidence before releasing ownership. This
inspection works while Temporal or ArgoCD's API is unavailable. Canceling running
work is a request to stop at a safe boundary, not an assertion that side effects
were undone.

Operator-run stages are attested through `POST /deployments/:id/attestations`
by a distinct operator identity (X13): a machine credential with the `attest`
scope. The API refuses an attestation from any `execute` credential or from an
identity that has claimed, renewed or handed off the deployment, and it refuses
to start with a machine credential holding both `attest` and `execute`. The
attestor's token is the Delivery service item's `DELIVERY_ATTEST_TOKEN` field,
and its principal (`delivery-operator-attestor`, scopes `read` and `attest`) is
an entry of `DELIVERY_MACHINE_CREDENTIALS`.

A deployment is never owned by a different executor identity (D7). A
self-hosted service's deployment holds the global dispatch barrier (D8); after
applying, its executor calls `POST /deployments/:id/handoff`, leaving it owned
with a handoff marker and a frozen lease. Its one successor Workflow,
`delivery/<id>/successor`, claims the marker through
`POST /deployments/:id/successor` before continuing. No other identity, ordinary
claim or lease renewal takes the marker, and the outgoing Workflow's close is
not an orphan. The successor verifies acceptance and finishes; if it cannot,
the deployment ends recovery-required with its locks and barrier held.

Settlement readers never use the ArgoCD server or an executor credential. The
API container projects a short-lived token of its own ServiceAccount,
`delivery-forum-observer`, into one directory per reader, and each reader's Role
grants only what it reads. Kubernetes projects only the pod's own account, so
every reader token carries that account's whole authority: these read-only
Roles, the operator-ingress observer and, with the Forum capability, the Forum
exec that admission fences to one readonly command. The directories separate
use, not authority, and a homelab test pins the account's complete grant set. A
missing projection pauses settlement and keeps ownership.

| Reader Role                        | Grant                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `delivery-application-reader`      | get, list, watch Applications in `argocd`                                                               |
| `delivery-worker-recovery-reader`  | get, list, watch Pods and Deployments in `temporal`, `scout-beta` and `scout-prod`                      |
| `delivery-forum-baseline-reader`   | get, list, watch Pods, claims, Deployments, ReplicaSets and Jobs in the Forum namespaces                |
| `delivery-minecraft-report-reader` | a `delivery-tsmc-controller`-audience token; the controller reviews it and allows only its report `get` |

Use `toolkit deploy recover <DEPLOYMENT_ID> --expected-generation <N>
--operation-id <ARGO_OPERATION_UUID> --reason <EXPLANATION> --machine` after
inspecting the recorded operation directly; it opens the recovery intent and
settles it by readback.
An active operation, mismatched identity, missing read credential, or specialized
target keeps ownership locked. If no matching finished operation exists, use the
[guarded Delivery recovery procedure](../docs/wiki/src/content/docs/how-to/cut-a-homelab-release.md#recover-a-delivery-operation).
Its brokered export/settle helper rereads the held deployment, applies its frozen
selection through explicit `sync-managed --delivery-selection`, and retains the
actual finished operation requirement for independent unlock. It handles failures
before and after source selection. Stop the prior mutation executor before
settling; a closed Workflow alone does not prove its Activity process stopped.
Do not remove database locks to bypass that check.

Static sites, combined Scout frontends and Forum use separate content recovery
intents. `toolkit deploy sites recover` or `forum recover` requires an admin
credential, exact environment generation and reason. The matching `recovery`
command and UI show immutable history, native receipts and refusal messages.
Native inspection and bounded repair retain the frozen artifacts and original
backup. Independent settlement releases quarantine through a generation CAS;
the original failed result and accepted pointers remain unchanged. A failed
inspection keeps ownership. A journaled producer host awaiting restoration
continues to block dispatch even after settlement succeeds. Generic Argo unlock
cannot bypass these checks or authorize a database rollback. Follow the
[content recovery procedure](../docs/wiki/src/content/docs/how-to/cut-a-homelab-release.md#recover-a-site-or-forum-release).

A model `tofu` recipe has no Application, so its recovery intent is a platform
recovery. The recovery Job runs with the runner its admission froze, from the
stack archive its selection froze (X8), and proves the plan Job and, once a
plan was saved, the apply Job. Recovery converges forward only: the stack must
equal that frozen source with zero proposed changes, directly or after an exact
recovery plan is approved by the stack's policy and applied. The saved plan's
state lineage bounds both.

Ordinary worker rollout admission requires a verified retained-host baseline.
Fixed-profile pipelines support independent host-only baseline verification.
The reviewed source catalog transfers release ownership only after hosting,
routing proofs, and recovery are verified. Forum
upgrade admission requires a verified accepted baseline and its frozen prior
configuration.
After an owned Forum sync succeeds, verification waits at most five minutes for
genuine Synced and Healthy status while rechecking the exact release and active
claim. Pending status never accepts a release or repeats its migration.

## Root and OpenTofu releases

A genuine qualified `gitops` CI build can carry `platformChanges`: the complete
root chart-to-original-artifact map, affected managed OpenTofu stacks, and exact
independent site archive prerequisites. Chart receipts identify bytes actually
packaged and pushed by that CI producer. Catalog-enabled Helm publication really
repackages older unchanged charts; only a retry of that same producer can reuse
its verified existing archive. An infrastructure-only source build retains an
original qualified `chart:apps` reference without claiming it produced those bytes.

The reviewed ops-model platform policy preserves the existing automatic stacks
and credential stacks that require reviewed plans. Operator-only and
preparation-only stacks retain their independent workflows. Publication expands
dependency closure: SeaweedFS, Tailscale, and Arr precede root; Cloudflare follows
root and the exact affected static archives. Platform selection waits for each
frozen prerequisite rather than resolving newer inputs while executing.

`POST /api/v1/platform/deployments` creates separate `root-release`, `tofu-plan`,
and `tofu-apply` deployments. They share durable outbox, immutable evidence, and
ownership with ordinary deployments, plus one persistent platform lock for shared
resources. Read-only planning releases that lock at completion. Root and apply
effects require reviewed source `platformDeliveryDelegated`; its default false
keeps the legacy writer authoritative. Root additionally requires central worker
delegation so it cannot restart the protected executor through the Temporal chart.

Each apply freezes one successful unexpired plan. Plans bind the original source,
stack, native Job UID/specification, state lineage/serial, and plaintext digest.
AES-256-GCM envelopes use a dedicated key and authenticated receipt metadata;
plaintext is bounded to 8 MiB and plan lifetime to 24 hours. The API stores only
the encrypted plan and consumes it once. Reviewed credential stacks require a
human decision on that exact apply; automatic stacks do not gain an extra manual
approval. The apply recipe rechecks native state before consuming the saved plan.

Execute-only `POST /api/v1/platform/plans` records the result. Execute-only
`GET /api/v1/platform/plans/:planDeploymentId` supplies the encrypted bytes to the
fixed apply Job; reader and UI responses expose only metadata. The Job receives
a dedicated execute-only item, and provider children receive no Delivery API or
1Password credential. Platform recipes run on a separate Activity queue and
service account from ordinary release execution. Ambiguous native results retain
ownership. Successful root/apply completion advances only
`acceptedPlatformDeploymentId`, preserving ordinary application acceptance.

Root charts retain their original canonical service owner, digest and source;
cross-service references do not create new component aliases. Before source
transfer, read-only plans use the legacy owner's dependency ordering. After
transfer, admission checks frozen prerequisites against current accepted platform
and site state. A canceled or failed automatic release is not recreated for the
same source, and an apply never replans after human approval.

Use the platform destination form or
`toolkit deploy platform request --file <reviewed-intent.json> --machine`.
Requests require a request ID, environment ID and expected environment generation.
Root and plan requests select the original source build; apply selects the exact
successful plan deployment ID. Inspect and approve the resulting frozen deployment
through ordinary status and human approval commands.

Independent static sites wait for genuine root acceptance before activation.
Root snapshots retain each selected original archive ID. A newer accepted root
may explicitly retain an archive from an older source; source SHA equality is
not required. A site-only change uses the current accepted infrastructure.
Explicit rollback retains the archive's earlier genuine site/root acceptance
history. Root, Cloudflare application, and site effects serialize through their
existing ownership records. Combined Scout releases retain their own backend-first
boundary and do not participate in this independent-site prerequisite.

`PlatformRecoveryIntent` preserves a failed root, OpenTofu, or control-plane
result while independently settling its quarantine. An administrator creates an
intent for the exact held environment generation. Read-only inspection must prove
the original Workflow closed, every original and historical recovery Job settled,
and an exact frozen desired or genuinely accepted prior target. Missing Job
receipts or deleted resources alone never prove that an external write did not
occur. Completion within sixty seconds uses the original snapshot and ownership
CAS; it releases locks without advancing any acceptance pointer.

A first Discord apply without an accepted prior may instead settle the
`original` target. Inspection authenticates its original approved saved plan,
compares all six managed before values and all six computed application
baselines with fresh provider reads, and requires the same state lineage with a
nondecreasing serial that stays stable during inspection. A serial increase is
recorded; this proves the original target, not unchanged state history or a
successful apply. The same Workflow, terminal Job, freshness and ownership CAS
checks still apply, and no acceptance pointer advances.

Partial OpenTofu recovery produces a new immutable encrypted plan on that same
intent. Its receipt names the recovery intent, original source/stack, state,
digest, expiration, and native Job identity. Only execute-scoped plan endpoints
expose encrypted bytes. Existing reviewed-plan policies require a human decision
on the exact public plan fingerprint; routine stacks retain automatic policy.
The apply child checkpoints its native UID and passes fresh admission before
consuming those saved bytes. A pause prevents that new effect while retaining
read-only inspection and evidence recording. The brokered one-shot recovery
runner supports an unavailable Delivery Workflow worker; it uses the same intent
and API rather than deleting a lock directly.

## Retained Workflow workers

Each environment owns a PostgreSQL `WorkerVersion` pool keyed by the exact
Temporal build ID (the original image source revision). A record retains its
original qualified artifact/build identities, image digest and runtime manifest
digests, introducing deployment, and a fixed reviewed host profile. Central hosts
serve `monorepo-workflows` in both `prod` and `beta`; Scout hosts serve their one
stage namespace and queue. Host profiles contain no arbitrary pod settings or
credentials. Worker records and artifacts are retained when their desired replica
count becomes zero.

Delivery's executor, platform worker, TSMC controller, and their capabilities
belong to a separate `delivery-control-plane` chart/Application and catalog
service. Its environment is `delivery-control-plane/prod`. The image remains an
original qualified `image:temporal-worker` artifact owned by its producer;
the control-plane snapshot explicitly references it without creating an alias.
Ordinary Temporal version sets contain only application/worker components.
Rolling an application back therefore cannot reconstruct older executor commands,
probes, credentials, or Pod templates. A separate admin operation upgrades the
control plane under global execution quiescence and its own Application ownership.
The shared Git bootstrap image pin remains legacy-owned until both image consumers
transfer; selected control-plane versions and acceptance remain in PostgreSQL.

`toolkit deploy platform control-plane --file <reviewed-intent.json> --machine`
selects original image/chart artifact IDs for this fixed environment. Initial
adoption also names original prior image/chart IDs, which the native Job observes
independently. Later requests freeze the successful acceptance or independently
recovered exact source. A chart-only upgrade can reuse an unchanged original
Temporal image. Controller replacement waits for existing work to drain and
blocks new claims globally; an ambiguous result retains that barrier until the
independent recovery procedure proves settlement.

`GET /api/v1/environments/:id/workers` exposes the generation and retained pool
to authenticated readers. Admin-only `POST /api/v1/workers` adopts a qualified
original artifact selected by a verified accepted deployment or independently
verified host-only baseline. Adoption uses the
expected environment generation and is rejected while deployment inputs are
pending or owned. An observation import cannot establish that baseline.

Initial migration uses an admin-only `adopt-worker` deployment intent through
`POST /api/v1/deployments`, with the current qualified full-app version set and
`workerBaseline: { artifactIds, candidateArtifactId }`. The artifact IDs reference
every observed original worker host; the candidate identifies existing
Temporal current routing. Legacy Activities and Workflows may use different
revisions, so the routed candidate may differ from the full-app image. The
executor independently verifies unchanged Argo source/health, actual host and
runtime image identities, baked source revisions, and every served route twice.
An original image publication whose full CI is pending or failed can be retained
only through this native host observation, with its original build/source and
runtime digests unchanged. Its image, source and deterministic baseline stages
must succeed before materialization. Later reads require that exact successful
adoption lineage; the image remains ineligible for new release selection or
version-set composition until it independently qualifies. The captured native
chart may predate the qualified version set used to anchor the request.
This host-only history never advances desired, observed, or accepted application
revisions or configuration and cannot serve as a full-app rollback target.
The first subsequent complete rollout establishes application acceptance.

A deployment freezes its complete worker pool with its selected candidate,
pipeline, and configuration. Approval and duplicate request handling use that
same snapshot. Rollback restores the accepted candidate artifact and host
specification, recording the accepted deployment it restores. It also retains
newer live hosts; a historical zero never stops a currently live host. This
restores the exact target while safely retaining additional worker versions.

Deploy-scoped `POST /api/v1/workers/:id/retire` accepts only a request ID and the
expected environment/worker generations. It creates a normal identity-bound
`retire-worker` deployment with one frozen zero-replica host and the accepted
routing candidate unchanged. Scout production retirement requires human approval.
The intent changes no worker replica state and accepts no caller-supplied proof.

The executor supplies fresh proof when claiming retirement and again immediately
before effects. Every served namespace/queue must exclude the retired build from
current and ramping routing and report zero exact open executions. The drainage
proof requires a check after the version's last deactivation.
An `inactive-unreferenced` proof covers an exact current `INACTIVE` incarnation
with its server creation time, no returned activation history, and repeated unchanged version,
routing, and zero-open observations. This proof invents no drainage timestamps;
idle pollers may remain until the guarded scale-to-zero operation. It does not
claim that an earlier deleted incarnation never ran.
Fresh routing and deactivation observations where applicable,
conflict tokens, and absence of candidate/canary/rollback references are required;
`DRAINED` alone is insufficient. PostgreSQL rechecks references, generations, and
the held environment/Application ownership on repeated claims. The same lock
covers selection, synchronization, and acceptance. Only successful acceptance
commits desired replicas zero; ambiguous failure retains ownership and the live
pool record. Historical artifacts remain available for a later approved rollback
that rehosts their exact original image. Deletion is a separate guarded prune.

Worker recovery uses a separate admin-authorized `WorkerRecoveryIntent`, created
by `POST /api/v1/deployments/:id/worker-recovery` with an exact environment
generation, request ID and inspection reason. The intent binds the frozen
deployment and current pool fingerprints. A scoped executor checks settled Argo
and Job identities, original hosts, and stable routing in every served
namespace. It reads the Application and the pool namespace's Deployments and
worker Pods only through `GET /api/v1/worker-recovery/:id/observation`, which
the API answers with its own readers, never the executor's ArgoCD token.
Completion accepts observations no older than sixty seconds
and rechecks the environment generation, both fingerprints and held Application
lock in one transaction. It records the evidence and releases quarantine while
preserving the original failed or canceled result, accepted release and worker
replicas. Generic Argo recovery cannot bypass this worker-specific proof.
The dedicated Workflow and the independent operator entrypoint use the same
read-only verifier; a healthy Delivery Workflow worker is not required for the
intent/completion API. Failed inspection retains quarantine. `toolkit deploy
workers recover` creates an intent; `workers recovery` inspects its state.

## Artifact origin and reuse

CI builds identify genuine first-party outputs. External artifacts additionally
record their original origin: upstream repository/name/version/checksum, or the
licensed bundle's manifest identity, XenForo version and original producer source.
An acquisition's first-party source revision identifies its verification checkout,
not the upstream chart's source. External builds have no invented CI URL. An
acquisition records the main pipeline that performed it (`repositoryId` and
`pipelineNumber`, its order key); rows acquired before that field keep NULLs.

Build source kinds are `ci` (the exact main-branch pipeline), `upstream` (an
acquisition verified against the upstream's published checksum), `attested`
(an operator-run producer whose evidence is recorded with the build) and the
older `licensed-bundle` rows that `attested` replaces. Every new build receives
`registrationSequence` from a global PostgreSQL sequence; it is the order key of
an attested build. Forum bundle publication creates an `attested` build whose
artifact keeps the `licensed-bundle` origin.

Bytes are the identity. Automatic composition compares every component's digest
with the base set revision; a build whose artifacts carry new ids but identical
digests composes nothing, and its rows stay unselected. Chart artifacts also
carry `contentFingerprint`, the producer's chart content hash with the version
string excluded, so CI can retain an unchanged chart instead of republishing it
under a new version.

Bytes in self-hosted stores (`s3://delivery-artifacts/`,
`s3://storm-forum-releases/`) are replicated off-cluster before their build is
verified. The executor lists `GET /api/v1/replication/pending`, copies each
object to the R2 backup bucket through the SeaweedFS backup package (the same
object key the daily snapshot uses, so the next snapshot reuses it), and records
the receipt with `POST /api/v1/artifacts/replication`. `qualify` answers
`pending` for a build whose produced archive lacks a receipt; images and charts
in external registries rely on registry retention, an accepted risk. The copy
runs on the Temporal `backup` worker, which runs one Activity at a time: while a
daily snapshot holds it, each dispatch tick reports the replication as failed
and retries on the next tick, so affected builds stay `pending` until the
snapshot ends.

Forum adoption preserves the original runtime's genuine CI/source identity and
the original licensed archive's digest and producer revision. When that immutable
revision predates the neutral dependency file, acquisition and original-baseline
inspection project only the licensed dependency fields from that revision's
`packages/storm-forum/config/forum.json`. A missing or invalid original manifest
blocks adoption. New release candidates always require the neutral policy at
their own original runtime revision.

An old runtime can be inspected without upgrading XenForo or installing the new
observer endpoint. The API's dedicated projected Kubernetes identity permits only
the fixed read-only PHP recipe in the canonical web container; CONNECT admission
rejects other commands, stdin and TTY. The inspector fences the real Application,
completed release Job, ready Pod owners/images, and both original bound PVCs before
and after observation. It repeats the same native proof immediately before the
first candidate selection. This establishes only a baseline pointer, never an
accepted application version. New observer-capable runtimes use the authenticated
HTTP reader. The API's observer token is not mounted into migration or Tailscale
containers, and its identity cannot read Secrets or create Pods.

Independent upstream acquisition is restricted to version-catalog entries that
declare `component: true` (`packages/version-catalog/src/catalog.json`), under
the component name the catalog document uses (`catalogComponentName`: a chart
by its name, an image by its repository basename, a GitHub source as
`archive:<repository>`), for a service the catalog
document declares as acquiring that component. An alias entry is pulled from
and verified at its `packageName` repository. A chart
entry is verified by bounded reads of the upstream index and archive against
the index checksum; an image entry, or a chart served from an OCI registry
(`datasource: docker`, such as Kueue's `oci://registry.k8s.io/kueue/charts/kueue`),
is verified by resolving its tag to the manifest digest through the registry
API and comparing it with the pinned digest, and an OCI chart's manifest must
carry Helm's chart config. Manifests are read from the catalog registry;
`registry.k8s.io` alone may redirect the read to its regional Artifact
Registry backing. A GitHub source entry pinned by tag (such as
`adyanth/cloudflare-operator`, which a Git-sourced Application syncs) is
acquired as the tarball of the commit the tag names. The acquiring pipeline
stores it content-addressed at
`s3://delivery-artifacts/sources/<owner>/<repo>/<sha256>.tar.gz` and registers it with
the commit as the artifact version and the tag in its origin. The server
resolves the tag to its commit on GitHub, requires that commit, and requires
the commit's tarball to hash to the digest. The build stays pending until the
stored tarball's off-cluster replica is recorded (PC1), and a later acquisition
of the same original verifies it. A recipe whose Application has a Git source
binds that archive's version, an exact commit, as `targetRevision`, so ArgoCD
syncs only that commit. For charts and images, the artifact URI is the upstream location; nothing new is mirrored. The
Minecraft chart stays mirrored into ChartMuseum because the registered
`minecraft-tsmc` pipeline pulls it from there, and the server verifies mirror
bytes against the upstream checksum as well. Existing mirrored rows are never
rewritten. An immutable origin key per acquiring service makes concurrent acquisitions
by that service reuse one original artifact/build/source, while each service
the catalog names acquires its own; an unrelated acquiring CI failure does not
invalidate those independently verified bytes. `findQualifiedArtifact` returns
exact original metadata or a useful 404; omitting `version` matches bytes by
digest alone, which is how producers retain an unchanged archive.

A genuine CI publication may select `retainedArtifactIds`. PostgreSQL records
these references separately from artifact ownership, verifies qualification and
service/repository ownership, and never clones or relabels the original artifact.
Automatic composition remains tied to genuine main CI qualification. An external
acquisition alone creates no automatic version, and a publication retaining an
unchanged component selection creates no new version or redeployment. Manual
compositions remain separate from the automatic composition base.

## Operations

TRMNL dashboard releases activate their exact original qualified plugin archive
after backend runtime verification. The fixed three plugin targets must all read
back correctly before application acceptance. An ambiguous update keeps ownership.
An admin can request `toolkit deploy trmnl repair <failed-deployment> --machine
--expected-generation <N> --reason <explanation>`; this creates a new immutable
`repair-trmnl` Deployment with the same bundle, pipeline and configuration. Fresh
executor observations must prove the original Workflow closed before transferring
quarantine and before each plugin write. Repair changes no Argo source or accepted
application pointer, preserves the original failed result, and releases ownership
only after exact remote readback. The same bounded runner supports executor outages.

The optional API TRMNL capability projects its dedicated archive reader and plugin
key together. The reader grants only `Read:delivery-artifacts/trmnl-plugins/*`;
API recovery code uses GET, but the upstream plugin key itself permits writes.
Source activation remains disabled until the scoped credentials are materialized.

Woodpecker mirrors only the dedicated `delivery-ci-publisher` item (publisher token)
and `ci-build-handoff` item (handoff access/secret key pair), alongside its separate
artifact publication credentials. It never mirrors the broader Delivery service
or SeaweedFS administrative item. Rotation must update the issuer/API credential
registration and scoped publisher copy together, or the handoff IAM credential and
its scoped copy together; do not restore broad item projections.

The machine listener's `/metrics` endpoint exposes database-backed queue,
outbox, ownership, recovery and retained-worker gauges. Labels use bounded
operation enums; artifact IDs, actors and request IDs are not metric labels.
The activated homelab service includes a matching ServiceMonitor and alerts
for unavailability, delayed dispatch and required independent recovery.

PostgreSQL is the permanent catalog and audit source; Temporal owns durable
execution. Restore PostgreSQL from its declared homelab backups and inspect
outbox/workflow/Argo operation identities before resuming submissions. Recovery
of this control plane must remain possible through the repository's independent
infrastructure tooling.
