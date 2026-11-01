# Delivery

Delivery is the system of record for what has been built, what is selected to
run, where it runs, and what proved it ([model](docs/model.md)). It records
builds, artifacts and set revisions in PostgreSQL, admits deployments of
selections, and exposes one authenticated API used by its React UI, toolkit,
and Temporal workers. Woodpecker builds; Temporal executes deployments; target
adapters apply them. ArgoCD is the adapter for Kubernetes, and Delivery creates
every Application from its recipe body
([section 8](docs/model.md#8-position-on-argocd)). Git holds source and the
catalog. Delivery does not commit deployment state back to Git.

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
configuration rebind, monitor observations and a quarantined deploy through Delivery's own APIs (`e2e/model.ts`), plus a tofu stack waiting
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

| URL                            | Page                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `/commits` (home)              | Recent commits, each with a one-line "is it deployed?" verdict |
| `/commits/:sha`                | One commit: CI, and every changed service by environment       |
| `/pipelines`                   | Every pipeline's newest execution, attention items, tools      |
| `/pipelines/:id`               | Promotion: source, build, test, version set, environments      |
| `/pipelines/:id/executions`    | Every build or composed version set and where it deployed      |
| `/builds/:id`, `/versions/:id` | One change end to end, with commit, CI run and artifacts       |
| `/deployments/:id`             | Steps, selection, approval, a tofu plan waiting for approval   |
| `/environments/:id`            | Selection, monitor, rollback candidates, form                  |
| `/recovery-intents/:id`        | One unified recovery intent and its inspection evidence        |
| `/deployments`, `/approvals`   | Deployment history; pending approvals and plans, recent ones   |
| `/artifacts`, `/activity`      | Build qualification; the audit trail with catalog reconciles   |

A commit has one build per service, but only a build that produced a version
set (or a platform deployment) changed anything. `GET /api/v1/commits` and
`GET /api/v1/commits/:sha` (a full sha or an unambiguous prefix of at least
seven digits) answer "is it deployed?" from those rows alone. An environment
has the change when its accepted selection is the same or a later revision of
the same lineage; otherwise the newest deployment aimed at it says what is
happening. A commit's verdict is the most urgent of its services, then of its
builds: CI failed, deploy failed, needs approval, CI running, deploying, not
released, deployed. The response also regroups the same rows by environment name, `prod` first,
so a commit that touches many services still answers "is it in prod?" as one
count with its stragglers named. The pure rules live in
`src/infrastructure/hub/commit-status.ts`.

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
the routes, the executor, the hub and the toolkit read them; `contract` keeps
the shared build, artifact and evidence schemas. The hub and toolkit call the
model routes through `createDeliveryClient`, whose model methods
(`src/shared/model/routes-client.ts`) validate each request body before
sending and each response before use.

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
  retirement. `MonitorStatusSchema` carries the declared monitor and the
  latest observation so evidence reads against its threshold. The selection
  view names the declared recipe's kind, and the hub's environment detail
  names the release kind: that of the declared recipe a release freezes. An
  `operator-run` recipe is requested as one.
  `releaseKindOf` reads the stored kind as admission does, so a v1 `manual`
  pipeline is a `deploy` although the selection view normalises it to
  `operator-run`.
- Application render: `renderApplication` (`model/application-render.ts`)
  is the one rendering of a `kubernetes-application` recipe into its ArgoCD
  Application for one environment's selection; the executor writes it.
- Deployment and approval (4.12, 4.13): `CreateDeploymentV2Schema` with
  `deploy`, `promote`, `rollback` (naming `selectionDeploymentId`), `rebind`,
  `retire-host`, `channel-publish` and `operator-run`, plus the `override`
  marker; `ApprovalStatusSchema` and `ApprovalV2Schema` with `override`.
- Recovery (4.15): `RecoveryIntentV2Schema`, one intent shape keyed by
  deployment and sequence, with a `kind` inferred from the deployment.
- Evidence: `EvidenceInputSchema` in `contract`, including the `monitor`,
  `alarm`, `test`, `drift` and `attestation` kinds the model adds.

The API is rooted at `/api/v1`. The
[Delivery model reference](../docs/wiki/src/content/docs/reference/delivery-model.md#routes)
gives each model route's scope and toolkit command.

| Operation                                                       | Route                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Authenticated principal                                         | `GET /identity`                                                       |
| Environments, recent executions, eligible artifacts             | `GET /overview`                                                       |
| Immutable set revisions                                         | `GET /versions`, `GET /versions/:id`                                  |
| Latest qualified component artifact                             | `GET /artifacts/latest-qualified?serviceId=…&component=…&kind=…`      |
| Producer comparison base, pending or qualified                  | `GET /artifacts/latest-retainable?…&kind=…&beforePipeline=…`          |
| Register pending CI publication                                 | `POST /builds`                                                        |
| Compose a manual set revision                                   | `POST /versions`                                                      |
| Reconcile or read the catalog                                   | `POST /catalog/reconcile`, `GET /catalog`                             |
| Register a definition outside the catalog                       | `POST /pipelines`, `POST /environments`                               |
| Request a deployment of any kind                                | `POST /deployments`                                                   |
| Execution, stages, approval, evidence, saved plan               | `GET /deployments/:id`                                                |
| Human approval, or an override decision                         | `POST /deployments/:id/approval`                                      |
| Human approval or rejection of a tofu recipe's exact saved plan | `POST /deployments/:id/plan-approval`                                 |
| Cancel or retry                                                 | `POST /deployments/:id/cancel`, `POST /deployments/:id/retry`         |
| Accepted selection and declared binding                         | `GET /environments/:id/selection`                                     |
| Rollback candidates with exclusion reasons                      | `GET /environments/:id/rollback-candidates`                           |
| Monitor state of the accepted deployment                        | `GET /environments/:id/monitor`                                       |
| Open or inspect a recovery intent                               | `POST /deployments/:id/recovery-intents`, `GET /recovery-intents/:id` |
| Settle an `argo` recovery intent by readback                    | `POST /recovery-intents/:id/settle`                                   |
| Request native site/Forum recovery under the retained lock      | `POST /deployments/:id/content-recovery`                              |
| Inspect frozen content recovery and native receipts             | `GET /content-recovery/:id`                                           |
| Attest an operator-run stage                                    | `POST /deployments/:id/attestations`                                  |
| Retire a service                                                | `POST /services/:id/retire`                                           |
| Hub, service pipeline and paginated executions                  | `GET /hub`, `GET /services/:id/pipeline`, `…/executions`              |
| One change, traced from build or set revision                   | `GET /builds/:id`, `GET /versions/:id/trace`                          |
| Paginated deployments, builds and audit activity                | `GET /deployments`, `GET /builds`, `GET /activity`                    |
| Environment detail and approval queue                           | `GET /environments/:id`, `GET /approvals`                             |
| Woodpecker, GitHub and ArgoCD enrichment                        | `GET /builds/:id/ci`, `…/source`, `GET /environments/:id/runtime`     |
| Committed change stream                                         | `GET /events`                                                         |

Execute-scoped workers use `/qualification/pending`, `/builds/:id/qualify`,
`/reconcile`, `/dispatch/pending`, `/dispatch/monitor`, `/dispatch/:id/submitted`,
`/monitors/watching`, `/deployments/:id/monitor/observations`,
and deployment `claim`, `stages`, `finish`, and `orphan` operations. Workflow IDs come from the shared
`deliveryWorkflowId` helper.

The independent control-plane stage appends immutable evidence for native Job
admission, its dispatch journal, replay, and final acceptance. Exact proof replays
reuse existing records, including older indexed receipts. Stage operation identity
and completed-stage immutability remain mandatory; other stages retain indexed
evidence identities. A Minecraft release does not append a backup or restored
copy. Scheduled Velero backups are the only backup.

TSMC promotes automatically from the sandbox. Its server sub-recipe leads with
a `players-offline` step, which holds the release until nobody is connected.
The recipe contract allows at most one such gate and places it before sync.

The TSMC recipe's `minecraft-upgrade` step declares its `releaseMode`. A release
restarts the retained world PVC and requires the usual exact source, image,
reconciliation and runtime acceptance. Scheduled Velero backups are the only
backup. Omitted modes are `retained-volume-restart`. Historical rows may still
say `verified-restore`; that value parses and takes the same retained-volume
path. Unknown modes fail validation. An image rollback is the same restart and
does not restore an older world. Reconciliation failures use an ordinary `argo`
recovery intent, which requires the same recorded request, native operation
identity and settled external work before releasing ownership.

CI registration is pending until the backend verifies the exact Woodpecker
main-push pipeline reached success. Artifact selection cannot consume pending
or failed publications. Qualification and initial set revision composition commit
atomically; pipeline order prevents a late older build from becoming the newest
automatic selection. New sets retain unchanged components from their base.
The latest-qualified-artifact lookup reads the matching component and kind from
the newest coherent automatic set revision, ordered by its qualifying CI pipeline
number in the configured repository. Both the set's qualifying build and the
component's original build must be verified in that repository. It returns the
original artifact and source identity. Manual compositions and late outputs that
never entered an automatic set do not affect this read-only producer lookup;
a missing component in the newest set returns 404 without searching older sets.
Artifact requirements bind dependent components to exact digests; an incompatible
combination fails release qualification with a visible reason. Automatic selection
coalesces only queued, unapproved automatic requests. Cancellation, rejection or
a monitor alarm suppresses that revision until a new eligible revision or explicit
operator request.

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

The Delivery model's catalog (`packages/ops-model/catalog-document.json`)
replaces these definitions at the cutover window. Its recipe and
configuration revisions are the generated files under
[`registrations/v2`](registrations/v2), one directory per environment; the
homelab generator writes them from the Application constructors and its
agreement test keeps them equal. They take new revision ids, so the v1
definitions stay registered and readable.

Registration does not transfer ownership. The reviewed service catalog's
`deliveryDelegations` map controls the Argo Application ownership boundary.
The retired pin writer has no deployment or Git mutation implementation.
Ownership transfers only after the previous release automation is stopped.
Build-scoped image metadata remains complete so chart packaging retains its
verified dependencies. No selected release version is recorded in that map.

Scout's backend and frontend share one environment, version set, deployment,
target lock and acceptance result for each stage. Its `scoutSite` policy binds
the frontend archive to the exact backend image digest. The executor first
verifies the backend's runtime and worker rollout, then activates and verifies
that archive. Approval covers the complete frozen selection once, and a failed
site activation leaves the release unaccepted under the backend's recovery
ownership. Frontend-only builds retain the original qualified backend
artifact.

## Authentication and configuration

Environment variables are bootstrap and credentials: `DATABASE_URL`, `HOST`,
`PORT`, `PUBLIC_ORIGIN`, `ENVIRONMENT`, `WOODPECKER_URL`, `WOODPECKER_REPO_ID`,
`WOODPECKER_TOKEN`, `DELIVERY_MACHINE_CREDENTIALS`, `ARGOCD_SERVER_URL`,
`ARGOCD_RECOVERY_TOKEN`, and the optional read-only `DELIVERY_GH_TOKEN`.
`ARGOCD_RECOVERY_TOKEN` is a read-only ArgoCD credential for the hub's runtime
panel only; no settlement reader uses it. The API holds no R2 credential.

Recovery never reads ArgoCD through its server or with the executor's
credential. The API's independent reader runs as the
`delivery/delivery-application-reader` ServiceAccount and reads
`applications.argoproj.io` through the Kubernetes API with a projected token
([section 8](docs/model.md#8-position-on-argocd)). Recovery therefore works
while ArgoCD is down or upgrading.

Delivery's ArgoCD account creates, updates, deletes and syncs the Applications
its recipes name. The operator-run data layers, `delivery-data` and
`temporal-data`, stay outside that grant. Human ArgoCD accounts are read-only
on Applications; sync is an operation only Delivery performs. The break-glass
path is
[Regain write access to ArgoCD](../docs/wiki/src/content/docs/how-to/regain-write-access-to-argocd.md).

`toolkit deploy handover-context --machine` is an admin-only read of the API's
baked source identity, each environment's binding in the catalog as last
reconciled into PostgreSQL together with that reconciled `catalogRevision`
(the handover refuses unless it is the reviewed revision its descriptor
names), fresh write-admission state, the environments whose
catalog lifecycle is `active` and so admit deployments, and uncapped PostgreSQL
ownership/request/recovery counts. It refuses before any catalog reconciliation
and after a definition was registered outside the catalog since then. The
bounded `packages/homelab/scripts/ci/delivery-handover.ts` operator command
consumes that state and the exact reviewed source proof, independently checks
the paused Woodpecker webhook and drained native pipelines, then transfers only
the registered Applications' ownership annotation and disables their
auto-sync. Each UID/resource-version CAS preserves the complete native source,
parameters, destination and unrelated metadata; external private receipts
record intent and readback. It resolves the `delivery` and `delivery-platform`
credentials from their reviewed activation item references and never falls
back to an operator admin token.

Static producers require their dedicated
`DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID` and
`DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY`; missing credentials fail before
starting an S3 operation. That identity can access only `delivery-artifacts`.
The executor uses distinct `DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID` and
`DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY` credentials to read archives and
mutate the reviewed website bucket allowlist. S3 write permission includes
deletion; immutable archive checks do not imply an append-only storage policy.
The allowlist lives in the homelab's `delivery-storage-policy.json` and is
checked against every `static-site` recipe.

Cache invalidation uses a dedicated Cloudflare user token with Cache Purge
permission on the recipes' exact zones. The existing encrypted
`cloudflare-tokens` OpenTofu stack owns issuance and its 1Password handoff.
The static-site executor holds both the storage and the cache credential.

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
from `woodpecker`, `github` and `argocd`. The GitHub token is the
`githubReader` 1Password item in the homelab Delivery activation, mounted as
`DELIVERY_GH_TOKEN`. It authenticates hub commit context and the independent
GitHub tag and tarball reads of source acquisition, which anonymously share the
egress IP's hourly quota with CI. It is currently CI's download token in
`ci-github-credentials`; a fine-grained public-read token replaces it.
Proxy trust is verified native ownership,
not a feature flag.
Pausing writes stops admission of new effects while allowing cancellation and
recording results of already owned operations. Environments whose approval
policy is `required` need a human approval bound to the frozen selection.

## Execution and recovery

Deployment requests, audit events, and outbox submissions commit together.
Idempotency keys bind the request to its authenticated actor and exact inputs.
Claiming work checks the environment's binding generation, records a lease and
acquires a durable lock on every target instance the recipe acts on, in
canonical order, plus at most one named shared lock. Different targets execute
independently. A global executor bound, held as typed configuration, limits
simultaneously owned deployments ([D10](docs/model.md#412-deployment)).

Admission evaluates every prerequisite edge of the environment, freezes each
prerequisite's accepted selection into the deployment, and rechecks on retry
([Z1](docs/model.md#418-prerequisite-edge)). Edges are the only declared
ordering between environments ([Z3](docs/model.md#418-prerequisite-edge)).

Rollback restores the named accepted deployment's set revision, recipe and
configuration. `GET /environments/:id/rollback-candidates` lists every
previously accepted selection, newest first and the accepted one included,
with the reason any is excluded: a lowered `forwardOnly` key, a crossed
`pointOfNoReturn` step, or a `forwardOnly` channel
([D9](docs/model.md#412-deployment)). Admission refuses an excluded candidate
with that reason. Promotion requires the source's accepted deployment to be
`settled` or `unmonitored`, and retries recheck it
([M2](docs/model.md#416-promotion-tree)).

A deployment has one approval decision, made by a human and bound to its
frozen selection ([4.13](docs/model.md#413-approval)). A request in an
environment whose policy is `required` waits in `awaiting_approval`; the
approval expires if the binding generation moves first. A non-eligible
`deploy` needs an approval marked `override` (H4), decided with
`approve --override`. A `tofu` recipe with an approve step takes its one
decision at that step on the saved plan, through
`POST /deployments/:id/plan-approval` with the plan digest (H6). A rejection
discards the plan, and the approve step ends the deployment failed and releases
its locks. An override of such a deployment is cleared at selection, before the
plan runs. A monitor's automatic rollback carries a `restoration` approval
instead (H5).

Desired, observed, and accepted pointers are separate. Success requires the
exact selected revision plus reconciliation and acceptance evidence. Failed
deployments block automatic successors. Canceling running work is a request to
stop at a safe boundary, not an assertion that side effects were undone.

An ambiguous effect, an expired lease or an unsettled sub-step ends the
deployment `recovery-required`, keeping its result and its locks
([4.15](docs/model.md#415-recovery-intent)). An administrator creates a
recovery intent with `POST /deployments/:id/recovery-intents`, supplying a
request ID, reason, expected generation and, for a compound recipe, the
sub-step. A deployment has at most one pending intent. Its `kind` follows the
deployment: `argo`, `worker`, `platform`, `content` or `minecraft`; a
`forum-baseline` intent comes from the Forum baseline inspection instead.

An `argo` intent settles through `POST /recovery-intents/:id/settle` (admin)
with the exact finished Argo operation UUID. The API reads the Application
object through its own reader and verifies the recorded request, the
environment ownership annotation, the finished operation and settled Jobs. It
rechecks the intent's binding generation and refuses an intent already
settled. Every other kind is refused there and settled by its own reader.
Settlement records what it found and releases ownership without accepting the
failed deployment or moving the accepted selection. Intent creation and
settlement work while writes are paused and while Temporal or ArgoCD's API is
unavailable; no route releases a recovery-required deployment's lock without
an intent.

`toolkit deploy recover <DEPLOYMENT_ID> --expected-generation <N> --reason
<EXPLANATION> --machine` opens the intent; with `--operation-id
<ARGO_OPERATION_UUID>` it then settles an `argo` intent by that readback.
`toolkit deploy recovery <INTENT_ID>` inspects an intent and its evidence. The
operator procedure is in
[Cut a homelab release](../docs/wiki/src/content/docs/how-to/cut-a-homelab-release.md#recover-a-deployment-that-requires-recovery).
An active operation, mismatched identity, missing read credential or unsettled
Job keeps ownership locked. Do not remove database locks to bypass that check.

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

`content` intents cover static sites, Scout frontends and Forum. Native
inspection and bounded repair retain the frozen artifacts and the original
backup. A failed inspection keeps ownership. A journaled producer host awaiting
restoration continues to block dispatch even after settlement succeeds. A
recovery intent never authorises a database rollback.

A model `tofu` recipe has no Application, so its recovery intent is a platform
recovery. The recovery Job runs with the runner its admission froze, from the
stack archive its selection froze (X8), and proves the plan Job and, once a
plan was saved, the apply Job. Recovery converges forward only: the stack must
equal that frozen source with zero proposed changes, directly or after an exact
recovery plan is approved by the stack's policy and applied. The saved plan's
state lineage bounds both.

Ordinary worker rollout admission requires a verified retained-host baseline.
Fixed-profile recipes support independent host-only baseline verification.
Forum upgrade admission requires a verified accepted baseline and its frozen
prior configuration. After an owned Forum sync succeeds, verification waits at
most five minutes for genuine Synced and Healthy status while rechecking the
exact release and active claim. Pending status never accepts a release or
repeats its migration.

An `operator-run` deployment records intent for each stage and then waits.
The operator performs the stage and posts attested evidence with
`POST /deployments/:id/attestations` (`toolkit deploy attest`); the stage
settles only on that evidence ([section 5](docs/model.md#5-target-kinds)).
The attestor is a distinct operator identity (X13): a machine credential with
the `attest` scope. The API refuses an attestation from any `execute`
credential or from an identity that has claimed, renewed or handed off the
deployment, and it refuses to start with a machine credential holding both
`attest` and `execute`. The attestor's token is the Delivery service item's
`DELIVERY_ATTEST_TOKEN` field, and its principal (`delivery-operator-attestor`,
scopes `read` and `attest`) is an entry of `DELIVERY_MACHINE_CREDENTIALS`.

A deployment of a self-hosted service (`delivery`, `delivery-control-plane`,
`temporal`, `argocd`) first acquires the global dispatch barrier: new claims
stop and queues drain before the effect ([D8](docs/model.md#412-deployment)).
A deployment is never owned by a different executor identity (D7). After
applying, its executor calls `POST /deployments/:id/handoff`, leaving it owned
with a handoff marker and a frozen lease. Its one successor Workflow,
`delivery/<id>/successor`, claims the marker through
`POST /deployments/:id/successor` before continuing. No other identity,
ordinary claim or lease renewal takes the marker, and the outgoing Workflow's
close is not an orphan. The successor verifies acceptance and finishes; if it
cannot, the deployment ends recovery-required with its locks and barrier held.

## Monitors

A recipe's oracle may declare a monitor: one image component, alarm matchers
that include an `environment` label, evidence queries with thresholds, and an
`automatic` or `hold` policy ([4.19](docs/model.md#419-monitor)). Queries may
use only `$window`, `$version` and `$gitSha`.

Acceptance starts the monitor: `watching` when the frozen recipe declares one,
otherwise `unmonitored`. The dispatch workflow lists `GET /monitors/watching`,
queries Prometheus for firing alerts and each evidence query, and posts the
result to `POST /deployments/:id/monitor/observations`. The API classifies the
observation in one transaction. Only an alarm in the monitor's set that became
active at or after the deployment's claim counts; an alarm already active is
recorded as pre-existing `alarm` evidence ([W2](docs/model.md#419-monitor)).

Every threshold met with no counted alarm settles the monitor and records
`monitor` evidence. A counted alarm records `alarm` evidence and suppresses the
alarmed set revision for automatic selection. Under `automatic` policy it also
queues a rollback to the latest earlier settled or unmonitored selection that
is an eligible rollback candidate. It carries that selection's approval as a
`restoration` approval ([H5](docs/model.md#413-approval)). With no such
candidate, or one never approved where policy requires approval, the
environment is held with the reason. Under `hold` policy the environment waits
for an operator. `promote` requires the source's accepted deployment to be
`settled` or `unmonitored` ([W3](docs/model.md#419-monitor)).

## OpenTofu stacks

Each stack is a service, `tofu-<stack>`, with one component,
`archive:tofu-<stack>`. CI freezes the stack directory, lock file and local
modules into that archive; `desired-state.json` is configuration, with
`forwardOnly` keys where a value must never decrease
([X8](docs/model.md#9-decisions)). The archive leaves it out, so each plan,
apply and recovery Job receives the frozen configuration's desired state in
its input. A `tofu` deployment runs plan, approval
where the environment's policy requires one, and apply as steps of one
deployment under the stack lock and the `platform` shared lock
([T1](docs/model.md#411-target)). Operator-only stacks are `operator-run`
environments.

Each apply freezes one successful unexpired plan. Plans bind the selected
archive digest, stack, native Job UID/specification, state lineage/serial,
and plaintext digest. AES-256-GCM envelopes use a dedicated key and
authenticated receipt metadata; plaintext is bounded to 8 MiB and plan lifetime
to 24 hours. The API stores only the encrypted plan and consumes it once.
Reviewed-plan stacks require a human decision on that exact apply; automatic
stacks do not gain an extra manual approval. The apply step rechecks native
state before consuming the saved plan. Execute-only plan endpoints supply the
encrypted bytes to the fixed apply Job; reader and UI responses expose only
metadata. Provider children receive no Delivery API or 1Password credential.

A `platform` recovery intent preserves a failed plan or apply while
independently settling its quarantine. Read-only inspection must prove the
original Workflow closed, every original and recovery Job settled, and an
exact frozen desired or genuinely accepted prior target. Missing Job receipts
or deleted resources alone never prove that an external write did not occur.
A first apply without an accepted prior may instead settle the `original`
target: inspection authenticates its approved saved plan against fresh
provider reads and a stable state lineage and serial. Partial recovery produces
a new immutable encrypted plan on the same intent, subject to the stack's
approval policy.

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
belong to the separate `delivery-control-plane` service and Application, with
the environment `delivery-control-plane/prod`. Its image is an original
qualified `image:temporal-worker` artifact owned by its producer and bound by
reference ([A5](docs/model.md#45-artifact)). Ordinary Temporal set revisions
contain only application and worker components. Rolling an application back
therefore cannot reconstruct older executor commands, probes, credentials, or
Pod templates. The control plane is a self-hosted service, so each of its
deployments runs under the global dispatch barrier described in
[Execution and recovery](#execution-and-recovery).

`GET /api/v1/environments/:id/workers` exposes the generation and retained pool
to authenticated readers. Admin-only `POST /api/v1/workers` adopts a qualified
original artifact selected by a verified accepted deployment or independently
verified host-only baseline. Adoption uses the
expected environment generation and is rejected while deployment inputs are
pending or owned.

A deployment freezes its complete worker pool with its selected candidate,
recipe, and configuration. Approval and duplicate request handling use that
same snapshot. Rollback restores the accepted candidate artifact and host
specification, recording the accepted deployment it restores. It also retains
newer live hosts; a historical zero never stops a currently live host. This
restores the exact target while safely retaining additional worker versions.

Deploy-scoped `POST /api/v1/workers/:id/retire` accepts only a request ID and the
expected environment/worker generations. It creates a normal identity-bound
`retire-host` deployment with one frozen zero-replica host and the accepted
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

Worker recovery uses a `worker` recovery intent, created through the shared
[recovery route](#execution-and-recovery) or
`POST /api/v1/deployments/:id/worker-recovery` with an exact environment
generation, request ID and inspection reason. The intent binds the frozen
deployment and current pool fingerprints. A scoped executor checks settled Argo
and Job identities, original hosts, and stable routing in every served
namespace. It reads the Application and the pool namespace's Deployments and
worker Pods only through `GET /api/v1/worker-recovery/:id/observation`, which
the API answers with its own readers, never the executor's ArgoCD token.
Completion accepts observations no older than sixty seconds and rechecks the
environment generation, both fingerprints and held Application lock in one
transaction. It records the evidence and releases quarantine while preserving
the original failed or canceled result, accepted release and worker replicas.
Generic Argo recovery cannot bypass this worker-specific proof. The dedicated
Workflow and the independent operator entrypoint use the same read-only
verifier; a healthy Delivery Workflow worker is not required for the
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
`s3://storm-forum-releases/`) are not copied elsewhere. Scheduled Velero
backups are the only backup; images and charts in external registries rely on
registry retention, an accepted risk.

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
the commit's tarball to hash to the digest, and a later acquisition of the
same original reuses it. A recipe whose Application has a Git source
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
operation enums and catalog environment and service IDs; deployment, artifact
and request IDs and actors are not metric labels.
The activated homelab service includes a matching ServiceMonitor and the
[Delivery alerts](../homelab/src/cdk8s/src/resources/delivery/monitoring.ts).

| Metric                                                                                                         | Alert                            | Fires when                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `up`                                                                                                           | `DeliveryUnavailable`            | the endpoint is not scraped for 5 minutes                                                                                       |
| `delivery_outbox_oldest_seconds`                                                                               | `DeliveryDispatchDelayed`        | a submission awaits Temporal acknowledgement over 10 minutes                                                                    |
| `delivery_recovery_required_deployments{environment,service_id,self_hosted}`                                   | `DeliveryRecoveryRequired`       | a recovery-required deployment holds the dispatch barrier for 5 minutes, one alert per target                                   |
| `delivery_queued_oldest_seconds{environment}`                                                                  | `DeliveryQueueStalled`           | an environment has waited over 3 hours to dispatch, for 10 minutes                                                              |
| `delivery_platform_lock_held_seconds{environment,service_id,holder_status,recovery_required,producer_barrier}` | `DeliveryPlatformLockStranded`   | a holder that is not running, not recovery-required and holds no content producer barrier keeps the platform lock for 5 minutes |
| `delivery_stale_ownership_released_total{kind}`                                                                | `DeliveryStaleOwnershipReleased` | the dispatch sweep released a lock or active pointer from a settled deployment in the last hour                                 |

`delivery_queued_oldest_seconds` counts from the oldest queued request's outbox
entry, and keeps counting through supersession: a queued automatic request a
newer set revision canceled still counts until the environment's next claim.
`delivery_deployments_superseded_total{environment}` counts those cancellations.
Three hours exceeds the longest bounded holder of the barrier, the control
plane's 150-minute activity, so ordinary serialization never reaches it.
`delivery_platform_lock_held_seconds` is absent while the platform lock is
free. A terminal deployment that is not recovery-required holds nothing
([D11](docs/model.md#412-deployment)): finish, cancellation, rejection, orphan
recovery and every independent recovery settlement release its target locks,
the platform lock and the environment's active pointer in one transaction.
Content recovery alone keeps the platform lock as the journaled producer
barrier until the producer's restoration releases it. Each dispatch tick
(`POST /api/v1/reconcile`) also releases any such ownership a settled
deployment still holds, records a `deployment.stale_ownership_released` audit
row per released row, and counts it in
`delivery_stale_ownership_released_total{kind}` (`target_lock`,
`platform_lock`, `active_deployment`). It never touches a running or
recovery-required deployment. A release means some transition, or a manual
database change, settled a deployment without releasing it. The response is
[Respond to a stalled Delivery dispatch](../docs/wiki/src/content/docs/how-to/cut-a-homelab-release.md#respond-to-a-stalled-delivery-dispatch).

PostgreSQL is the permanent record and audit source; Temporal owns durable
execution. Scheduled Velero backups of the database volumes are the only
backup of the record; there is no separate snapshot, replica or restore tool.
Changes to the Delivery and Temporal PostgreSQL clusters are `operator-run`
deployments of `delivery-data` and `temporal-data`, never part of an image or
chart deployment.
