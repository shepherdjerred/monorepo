# Delivery model

This document specifies the target model for Delivery: the primitives, their
identities and invariants, the kinds of target they can act on, and how every
class of software this repository ships maps onto them. It describes the
intended state. Where the current implementation differs, the difference is
named so the two converge rather than drift. Code names that differ from the
model's vocabulary are in the glossary.

The shape is deliberately close to Amazon's Brazil (build), version sets,
Apollo (deployment) and Pipelines (promotion), scaled to one operator and one
cluster. Nothing here depends on Kubernetes, Helm, ArgoCD, or Git holding
anything but source and definitions.

Conventions. Invariants are numbered by primitive (S1, K1, B1, …). Guarantees
are G1 to G5. Decisions are X1 to X14. "Set revision" is always written in
full; the bare word "revision" is not used. "Accepted" means the current
accepted selection; "previously accepted" means any selection that was ever
accepted.

## 1. Purpose and scope

Delivery is the single system of record for what has been built, what is
selected to run, where it is running, and what evidence proved it. It covers
every unit of software this repository produces or acquires and then places
somewhere: hosted services, static sites, infrastructure, cluster bootstrap,
third-party charts and images, native application channels.

Delivery is not a build system, a secrets manager, or a Kubernetes reconciler.
Woodpecker builds. 1Password holds secrets. Target adapters reconcile.

## 2. Guarantees

| Id  | Property        | Meaning                                                                                                                                                                                                                                                  | Delivered by                         |
| --- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| G1  | Reproducibility | Any previously accepted selection can be identified, fetched byte-for-byte, and redeployed.                                                                                                                                                              | A1, A6, R1, P1, F1, precondition PC1 |
| G2  | Consistency     | An environment's accepted selection is one set revision whose components satisfied every declared constraint; in settled state only the accepted selection and retained hosts are live; while a deployment is owned, its desired selection is also live. | K1, R2, A3, E4, M2, T3               |
| G3  | Independence    | One service's release never waits on, or is broken by, another service's release unless a declared edge (a tracking reference or a prerequisite) says so.                                                                                                | S2, T1, A5, Z1                       |
| G4  | Evidence        | Every change to a running system is a recorded deployment with recorded acceptance, or, for `operator-run`, an operator attestation recorded with its evidence. Nothing is believed because a file in Git says so.                                       | C3, D1, V1, V3, T5                   |
| G5  | Recoverability  | Any ambiguous effect leaves ownership held until an independent inspection settles it. The record survives loss of the executor, and loss of the record is detectable and reconcilable.                                                                  | D1, D5, D7, I1, precondition PC2     |

Preconditions the guarantees rest on and the model cannot provide by itself:

- PC1. Artifact bytes in self-hosted stores (ChartMuseum, SeaweedFS) are
  replicated to off-cluster storage before a build is `verified`, and
  restoring those stores from the replica is a bootstrap step (section 6).
  Artifacts in external registries (Docker Hub, upstream chart
  repositories) and versions published to audience-facing channels (npm)
  rely on the registry's retention; this is an accepted risk (X11).
- PC2. Delivery's and Temporal's databases archive write-ahead logs to
  off-cluster storage. A restore from periodic volume snapshots alone cannot
  satisfy G5.

## 3. Ownership boundary

Git owns source, the catalog (section 4.1), recipe revisions, configuration
revisions, prerequisite edges, and acquisition intents. Delivery owns builds,
artifacts, set revisions, selections, environment pointers, deployments,
approvals, recovery intents, and evidence. No version of anything that runs
is recorded in Git. The cold-start snapshot (section 6) is written to
off-cluster storage by Delivery, not to Git.

**Runtime substrate.** PostgreSQL is the record. Temporal is durable
execution and the home of all recurring work; there are no Kubernetes
CronJobs. S3 (SeaweedFS in the cluster, R2 off the cluster) holds artifact
stores, OpenTofu state, off-cluster replicas and the cold-start snapshot.
Kubernetes plays two roles: it is the target for hosted workloads, reached
through ArgoCD, and it is the sandbox in which a stage that is credentialed,
heavy or toolchain-specific runs as an ephemeral Job under the batch
scheduler on the CI node. A Job is how a stage executes, not a primitive;
Temporal owns ordering and durability, the Job owns isolated compute and an
identity that survives the executor.

## 4. Primitives

### 4.1 Catalog

**Definition.** The single Git-owned registry that defines every service, its
components, its environments, its prerequisite edges, and the recipe and
configuration revisions that exist as candidates for its environments.

**Identity.** One per repository. Versioned by Git commit; a deployment
freezes the catalog revision it was admitted under.

**Invariants.**

- C1. A service, component, environment, or prerequisite edge exists if and
  only if the catalog defines it. For rollback admission, C1 is evaluated
  against the catalog revision frozen in the deployment being restored.
- C2. The catalog contains no selection of anything that runs: no artifact
  digest, chart revision, image tag or set revision that names which
  artifact an environment runs. Version-bearing values that are inputs
  rather than selections are allowed: a configuration value such as a
  PostgreSQL major version (4.8), an acquisition intent (4.17), and the
  version catalog's upstream entries that intents are read from. Executor
  runner images are components of the `ci` service bound by reference (A5),
  not literals.
- C3. Registering a definition has no effect on any running system. Effects
  come only from deployments.
- C4. A change to a service's component list bumps the binding generation
  (E1) of every environment of that service and is refused while any
  deployment of that service is `owned`.

**Is not.** A list of what is deployed. A pin file. Today's definition
sources (the ops-model service catalog and platform policy, the Delivery
registrations, the homelab target policy, the static release targets, and
the version catalog's upstream entries) are the material the catalog is
built from.

### 4.2 Service

**Definition.** The unit of ownership and release. Everything in one of its
set revisions releases together; anything that must release independently is
a separate service.

**Identity.** `serviceId`, globally unique.

**Attributes.** Owning package where one exists, ordered component list,
lifecycle state, whether it is `self-hosted` (its target hosts the executor,
the API, or the Kubernetes adapter).

**States.** `active` accepts builds and deployments. `retired` accepts no
builds or deployments and keeps every environment's state and history.
`removed` has had its environments' target state deliberately destroyed and
keeps only history. Transitions are forward only.

**Invariants.**

- S1. A service's component list is fixed per catalog revision. Changing it
  starts a new lineage of set revisions (R5).
- S2. Two services share no component. They may reference the same artifact
  (A5).
- S3. `retire` and `remove` are refused while any deployment of the service
  is `owned` or `recovery-required`. `remove` records a `target-destroyed`
  evidence entry that releases any remaining lock with that reason. Retiring
  or removing an environment, or its service, is also refused while the
  environment's accepted recipe deploys an Application with no lifecycle
  policy, such as a carried v1 recipe (section 7), until a rebind accepts
  one that declares it: only an active environment admits the rebind.
- S4. A retired service's environments keep their accepted selection and
  retained hosts. No deployment of any kind is admitted.

**Is not.** A repository, a workspace package, a Helm chart, an ArgoCD
Application, or a namespace.

### 4.3 Component

**Definition.** A named, typed slot in a service's set revision that holds
exactly one artifact per set revision.

**Identity.** `serviceId` plus component name. Names carry their type as a
prefix: `image:`, `chart:`, `archive:`.

**Attributes.** Type (`image`, `chart`, `archive`); producer (a first-party
package, an acquisition intent, or a reference to another service's
component under A5); for references, the mode `pinned` or `tracking`.

**Invariants.**

- K1. Every set revision fills every component of its lineage with exactly
  one artifact.
- K2. A component exists for every version the service selects
  independently. A version that rides inside another artifact (an image
  version baked into a chart's values at chart build time) is not a
  component; it is part of that artifact's bytes and rolls back with it.
- K3. A service's components may mix producers. An upstream chart with a
  first-party image, or a first-party chart with acquired images, are both
  single services.

**Is not.** A file, a Kubernetes resource, or a lockfile dependency. Source
dependencies are resolved by the build, not by Delivery.

### 4.4 Build

**Definition.** One verified act of producing, acquiring, or attesting
artifacts for one service from one source revision.

**Identity.** Build id. Also unique on its idempotent request id.

**Attributes.** Service, source revision (the repository commit that produced
or performed the verification), source kind, order key, verification time,
qualification reason, the artifacts it produced, the artifacts it retained
by reference.

**Source kinds.**

- `ci`: first-party bytes built by the exact main-branch pipeline.
- `acquisition`: upstream bytes identified by digest or checksum and verified
  against the upstream's published checksum. They stay in their upstream
  store and are recorded by URI and digest (X11). Licensed bundles are the
  exception: their bytes are stored in private Delivery-owned storage.
- `attested`: bytes produced by an operator-run tool whose evidence (a
  notarization ticket, a signing log, a plan digest, an upgrade log) is
  recorded with the build. Used where CI cannot run the producer.

**States.** `pending` until the backend verifies the producing pipeline or
attestation; then `verified` or `failed`.

**Invariants.**

- B1. Only `verified` builds may supply artifacts to automatic composition.
- B2. A build never produces an artifact whose bytes already exist for the
  same component. It retains the existing artifact by reference. Chart bytes
  are compared with the version string excluded, and images by runtime
  fingerprint with build metadata (`VERSION`, `GIT_SHA`) excluded, so an
  unchanged chart or image is retained rather than republished. A producer
  compares against the newest pending or verified build of the current
  lineage, so it may retain an artifact of a still-pending build that
  precedes it in order key. The retaining build then verifies only after that
  build does, and fails if that build fails (B1).
- B3. An acquisition's source revision is the repository commit that
  performed and verified the acquisition, never the upstream project's
  source. Acquisitions execute inside the main-branch pipeline and carry its
  order key.
- B4. Every build carries an order key: repository plus pipeline number for
  `ci` and `acquisition`, registration sequence for `attested`. Order keys
  are total within a service.
- B5. One pipeline run may register builds for several services.
- B6. Storing an artifact's bytes in the service's artifact store (a private
  image repository, ChartMuseum, the Delivery artifact bucket) is part of
  the build, verified by reading the bytes back by digest. It is never a
  deployment: nobody but Delivery consumes an artifact store. Publishing to
  an audience is a `channel` deployment (section 5).

**Is not.** A Git commit, a CI run, or a deployment.

### 4.5 Artifact

**Definition.** Immutable bytes that fill one component, produced or retained
by one build.

**Identity.** Build plus component. The content digest (`sha256`) identifies
the bytes; two artifacts may share a digest, and bytes are stored once.

**Attributes.** Digest, URI, human version string, runtime digests (for
multi-platform images), origin, `requires`, retention state.

**Origins.**

- `first-party`: built from this repository.
- `upstream`: acquired. Records repository, name, version, and the upstream's
  own checksum. A Git source records its tag and the exact commit the tag
  named; its bytes are that commit's tarball, stored content-addressed in a
  self-hosted store, and the commit is the artifact's version.
- `licensed-bundle`: acquired under a licence that forbids redistribution in
  an image. Records manifest digest and producer source. Bytes are retained
  in private Delivery-owned storage.

**Invariants.**

- A1. Bytes are never rewritten under an existing digest.
- A2. An artifact belongs to exactly one build, which belongs to exactly one
  service.
- A3. `requires` maps other components to exact digests. Composition fails
  visibly when a set revision violates it. `requires` expresses byte-level
  compatibility inside one service; cross-service ordering is a prerequisite
  edge (4.18).
- A4. An artifact whose build is `pending` or `failed` is not selectable.
- A5. A component may be filled by another service's artifact. This is a
  reference, not a copy or an alias: the artifact keeps its producing build
  and service. A `pinned` reference changes only by catalog change or manual
  set revision. A `tracking` reference names a source service, component,
  and environment; the referencing service composes an automatic set
  revision in the transaction that accepts a selection in that environment
  whose referenced component changed. A tracking reference is a declared
  edge under G3.
- A6. Every artifact referenced by a previously accepted selection is
  retained in a registered artifact store, addressable by digest, until
  every service referencing it is `removed`. Self-hosted stores satisfy this
  through PC1; external registries through their own retention, which is an
  accepted risk (X11). An artifact whose store is not registered is not
  selectable.

**Is not.** A version. The version string is metadata. "Version" as a
standalone noun does not exist in this model.

### 4.6 Set revision

**Definition.** For one service, a total mapping from every component of one
lineage to one artifact, with a monotonic number and a base set revision.

**Identity.** `serviceId` plus number.

**Attributes.** Lineage (hash of the ordered component list it was composed
against), base, order key (from its qualifying build), `automatic` or
`manual`.

**Producer.** The backend, atomically with build qualification (automatic),
or an explicit operator composition (manual).

**Invariants.**

- R0. A service's first set revision has no base. Verified artifacts are
  recorded until some build's new and retained artifacts together fill every
  component; the first automatic set revision is composed in the
  transaction that verifies that build.
- R1. Immutable once created.
- R2. An automatic set revision is composed in the same transaction that
  verifies its build, or by a tracking recomposition (R7). It takes the
  build's new and retained artifacts and carries every unchanged component
  forward from its base. If the result equals its base in every digest, no
  set revision is created.
- R3. A manual set revision never becomes the base of an automatic one. A
  manual set revision is a hotfix: the next automatic set revision does not
  carry it forward, and its change persists only by landing in source.
- R4. The live set of a service is the automatic set revision of the current
  lineage with the highest order key. A verified build whose order key is
  below the live set's composes no set revision; its artifacts remain
  selectable through a manual set revision.
- R5. A set revision from a previous lineage is not eligible for `deploy` or
  `promote`. It remains a rollback source in full: a `rollback` restores the
  old-lineage selection exactly as frozen, and the environment is then bound
  to that lineage until a set revision of the current lineage is accepted.
- R6. A set revision says nothing about where it runs. Selections (4.9) say
  that.
- R7. A tracking recomposition composes an automatic set revision for a
  referencing service when the source environment of one of its `tracking`
  references accepts a selection whose referenced component changed. It
  takes the referencing service's live set, replaces the tracked component
  with the newly accepted artifact, records the source's accepting
  deployment as its trigger in place of a qualifying build, and takes the
  order key `(live set's order major, registration sequence)` so it orders
  after the live set and before the service's next CI build.

**Is not.** A deployment, an environment, or a Git tag.

### 4.7 Recipe

**Definition.** An immutable, target-typed description of how one environment
realises a selection: the target kind and instance, the binding of components
to that target's parameters, the complete target body where the kind needs
one (for `kubernetes-application`, the whole Application: destination,
project, sync options, ignore rules, lifecycle policy), the ordered sub-steps
for a compound target with any `pointOfNoReturn` marker, the name of a shared
lock if one is required, and the acceptance oracle.

**Identity.** Recipe id with revision suffix, for example `scout-prod/3`.

**Producer.** Humans, by reviewed pull request to the catalog.

**Invariants.**

- P1. Any change is a new recipe revision. Old revisions remain readable
  forever.
- P2. A deployment freezes the recipe revision it used. Rollback restores the
  recipe along with the set revision and configuration.
- P3. A recipe binds only components of its own service, including
  components filled by reference under A5.
- P4. A value that names a component, a sub-step, a lock, or an oracle
  belongs to the recipe. Every other target input is configuration (4.8).

**Is not.** A promotion tree. In code this primitive is currently named
`Pipeline`; see the glossary.

### 4.8 Configuration revision

**Definition.** Immutable, non-artifact, non-secret inputs to an environment
that are not recipe content under P4.

**Identity.** Configuration id with revision suffix.

**Attributes.** Key-value content; a `forwardOnly` marker per key.

**Examples.** Helm parameter values, an OpenTofu stack's desired-state file,
a PostgreSQL major version (`forwardOnly`), a release channel name.

**Invariants.**

- F1. Same immutability and freezing rules as recipes (P1, P2).
- F2. Secrets never enter Delivery. A target resolves them at execution time
  from the secrets manager.
- F3. A rollback candidate that would lower a `forwardOnly` key is refused
  with the reason (D9).

### 4.9 Selection

**Definition.** One set revision, one recipe revision, and one configuration
revision, for one environment.

**Identity.** Within an environment, the deployment that froze it; L1 makes
that one-to-one. There is no separate selection table, and rollback names
that deployment.

**Invariants.**

- L1. A deployment freezes exactly one selection. Acceptance, approval, and
  rollback operate on selections, never on a set revision alone.
- L2. Two selections differing in any coordinate are different selections.
  A configuration-only change is a new selection and needs its own
  deployment (`rebind`, 4.12) and its own approval where policy requires.

### 4.10 Environment

**Definition.** One running instance of a service: service plus name, bound
to exactly one accepted selection.

**Identity.** `serviceId/name`.

**Attributes.** Binding generation, desired selection, observed selection
(per sub-step for compound targets), accepted selection, retained host set,
automatic flag, optional promotion source environment, approval policy,
`durable` flag, lifecycle state, composition state.

**States.** `active`, `retired`, `removed`, as for services. Composition
state is `composable` or `blocked: <component> has no artifact`.

**Invariants.**

- E0. An environment with no accepted selection admits `deploy` and
  `promote` with a null from-pointer and is not a rollback source. If
  `automatic` is set and it has no promotion source, it receives a queued
  automatic deployment of the live set on the next reconciliation, so
  registration itself has no effect (C3).
- E1. The binding generation increments when the accepted selection changes
  by acceptance, when the service's component list changes (C4), and on
  `retire`. Nothing else changes it.
- E2. Every deployment names the binding generation it expects. A mismatch
  is rejected before any effect.
- E3. Desired, observed, and accepted are distinct pointers. Desired is what
  the owning deployment requested, observed is what the target reports,
  accepted is what passed acceptance (4.14). For a compound target the
  observed pointer is recorded per sub-step.
- E4. At most one accepted selection at a time. Only acceptance moves it.
- E5. The retained host set holds host records (artifact, host profile,
  replica count, generation, introducing deployment) whose hosts remain live
  until drained. A retained host is not an accepted selection. Rollback
  sources are previously accepted selections, not retained hosts.
- E6. A promotion source, if named, is an environment of the same service.
  Promotion-source edges form a tree with no cycle.
- E7. A non-durable environment is either a `replica`, which may run only
  set revisions currently or previously accepted by its named durable
  environment and holds no acceptance of its own, or a `qualification`
  environment, which runs candidate set revisions before any durable
  acceptance, whose oracle is a test suite, and which is a valid promotion
  source (M2). Qualification environments exist only for the service the
  repository exempts from exhaustive CI (Minecraft); extending them to
  another service requires changing that policy.

**Is not.** A stage name, a namespace, a cluster, or a host.

### 4.11 Target

**Definition.** An adapter that can realise a recipe kind against the world,
together with its lock scope and its acceptance oracle.

**Identity.** Target kind plus the instance the recipe names (an Application,
a bucket, a stack, a channel).

**Invariants.**

- T1. One lock per target instance. A deployment holds the locks of every
  instance it acts on, acquired in canonical order, plus at most one named
  shared lock, for its whole life. The `platform` shared lock serialises
  every effect on shared external resources (cluster root objects, Cloudflare
  zones, the state bucket) and keeps those effects mutually exclusive with
  site activation.
- T2. Target kinds differ only in how they apply bytes and what evidence they
  accept. The primitives above are the same for all of them.
- T3. A compound target executes ordered sub-steps under its locks and yields
  one acceptance. Each sub-step records intent before effect and settlement
  after. Resume starts at the first unsettled sub-step. A sub-step with
  recorded intent and unknown result moves the deployment to
  `recovery-required` naming that sub-step. A failed sub-step leaves the
  whole deployment unaccepted. A Tofu stack is never a sub-step: its saved
  plan, plan-step approval (H6) and apply bind one deployment of one stack
  (D6).
- T4. A target reads desired state only from the deployment holding its
  locks or, between deployments, from the environment's accepted selection,
  which it may re-assert as self-heal and must record as drift evidence
  (V3). Self-heal never changes the accepted selection.
- T5. Every external effect carries the deployment id into the target (sync
  operation info, release marker object, state metadata, feed manifest), and
  the target can be read back to recover it.
- T6. An instance is named by exactly one environment of one service.
- T7. The oracle of any service that can deny admission to the cluster must
  prove admission still works (a canary pod and volume claim) before
  acceptance.

**Kinds.** Section 5.

**Is not.** A place in the abstract. "Kubernetes" is not a target; one
Application in one cluster is.

### 4.12 Deployment

**Definition.** An immutable, identity-bound request to move one environment
from its accepted selection to a frozen selection under an expected binding
generation.

**Identity.** Deployment id. Also unique on its idempotent request id, which
binds the authenticated actor and the exact inputs.

**Kinds.**

- `deploy` selects any eligible set revision with the environment's current
  recipe and configuration.
- `promote` selects the set revision accepted in the promotion source.
- `rollback` selects a previously accepted selection in full.
- `rebind` keeps the accepted set revision and changes the recipe or
  configuration revision.
- `retire-host` removes one retained host after drainage proof.
- `carry` is recorded by the cutover's catalog reconcile, never requested: it
  freezes an accepted selection carried onto the catalog's identities
  (section 7), has no stages or effects, and is accepted in the same
  transaction.

**Eligibility.** A set revision is eligible for `deploy` when it is in the
current lineage, every artifact's build is `verified`, A3 holds, every
prerequisite edge holds (Z1), and, for an environment with a promotion
source, it is accepted there. A `deploy` of a non-eligible set revision
requires an approval marked `override`.

**Attributes.** Environment, expected binding generation, frozen selection,
frozen catalog revision, frozen snapshots of target-side state (retained
hosts, prerequisite acceptances, plan identity), stages, evidence, approvals,
result, executor lease, `recoveryRequired`.

**States.** `queued`; `owned` once every lock is held and a lease is
recorded, optionally carrying a `handoff` marker for a self-hosted
deployment awaiting its successor executor (D8); then exactly one terminal
result: `accepted`, `failed`, or `canceled`. `recovery-required` is an
ownership flag on a terminal result, not a fifth state: the result is kept
(I3) and the deployment keeps its locks until a recovery intent settles it.

**Invariants.**

- D1. Request, audit event, and outbox submission commit in one transaction.
- D2. A failed deployment blocks automatic successors in that environment
  until an operator acts.
- D3. Automatic selection coalesces only queued, unapproved automatic
  requests. Cancellation, rejection, or an alarm (W2) suppresses that
  selection until a newer eligible set revision exists or an operator asks
  explicitly. Automatic request identity keys on the environment's last
  terminal deployment, not on the binding generation.
- D4. Cancellation is a request to stop at a safe boundary, never an
  assertion that effects were undone.
- D5. An ambiguous external effect ends in `recovery-required`. Only an
  independent read of the target, using a read credential the executor does
  not hold, may release the locks.
- D6. Approval (4.13), where policy requires it, binds to the frozen
  selection. For `tofu` it additionally binds the plan digest and the state
  lineage and serial the plan was computed against.
- D7. `owned` records the executor workflow id and a lease. A deployment
  whose lease expires without renewal, or whose workflow is closed, becomes
  `recovery-required`. A deployment is never owned by a different executor
  identity, except the successor executor of a self-hosted handoff (D8); the
  same workflow may resume after a transient failure. Only the owning
  executor records the deployment's executor stages and finishes it; a
  native Job may re-record its own running stage, which renews nothing.
- D8. A deployment of a `self-hosted` service acquires a global dispatch
  barrier before effects: no other deployment is claimed while the barrier
  is held, queues are drained first, and the deployment's evidence source is
  frozen before applying. After applying, the outgoing executor leaves the
  deployment `owned` with a `handoff` marker and a frozen lease that does
  not expire; the successor executor takes ownership by reading the frozen
  record, verifies acceptance and finishes it. If no successor finishes it
  while the barrier is held, an operator settles it through a recovery
  intent. An ambiguous result retains the barrier.
- D9. The API computes an environment's rollback candidates from previously
  accepted selections, excluding any that would cross a `forwardOnly`
  configuration key or a `pointOfNoReturn` sub-step since acceptance, or
  whose target is a `forwardOnly` channel, and states the reason for each
  exclusion.
- D10. A global executor concurrency bound, held as configuration, limits
  simultaneously `owned` deployments.

**Is not.** A Kubernetes rollout, a Helm release, a sync, or a Git commit.
Those are effects a target may produce while executing a deployment.

### 4.13 Approval

**Definition.** A separate authenticated decision on one deployment's frozen
selection.

**Identity.** Deployment id. One decision per deployment, with the approver
recorded.

**States.** `pending`, `granted`, `rejected`, `expired`.

**Invariants.**

- H1. An approval is a distinct authenticated act from the request, even
  when the same operator performs both.
- H2. It binds to the deployment's frozen selection (D6). It becomes
  `expired` when the expected binding generation no longer matches (E2) or,
  for `tofu`, when the bound plan is consumed or expires.
- H3. `rejected` is the rejection D3 refers to.
- H4. An approval marked `override` is required for a non-eligible `deploy`
  and is recorded as such.
- H5. A `restoration` approval authorises an automatic `rollback` created by
  a monitor (W2) on an environment whose policy is `required`. The system
  creates it, it records the original approver and decision of the
  selection being restored, and it is valid only for a rollback to a
  selection that was itself approved and settled in that environment. It is
  the one exception to H1.
- H6. A `tofu` recipe with an approve step takes its approval at that step,
  on the saved plan (D6), and that decision satisfies the environment's
  policy; its selection alone is never approved. An override (H4) of such
  a deployment is cleared before the plan runs and recorded on the same
  approval, apart from the plan decision.

### 4.14 Acceptance

**Definition.** The evidence that the observed selection equals the desired
selection and that the recipe's oracle passed.

**Invariants.**

- V1. Only acceptance advances the accepted pointer (E4).
- V2. Only previously accepted selections are rollback sources.
- V3. Acceptance and drift evidence are appended, never edited, and name the
  exact observation they were drawn from.
- V4. Target health alone is not acceptance. The oracle may additionally
  require probes, readbacks, drainage proofs, admission canaries (T7), or
  data-preservation proofs.
- V5. Tests are oracle content, in two placements. A qualification test is
  the oracle of a non-durable qualification environment (E7) and gates
  promotion out of it. An acceptance test is part of a durable
  environment's oracle and gates acceptance there. Test runs execute as
  deployment stages on the CI worker node under the cluster's batch
  scheduler, not inside CI, and their results are evidence (V3).

### 4.15 Recovery intent

**Definition.** An operator-authorised inspection of one `recovery-required`
deployment, settled by an independent reader.

**Identity.** Deployment id plus sequence.

**Attributes.** Reason, expected binding generation, snapshot fingerprint of
the deployment and environment at creation, the sub-step it names for a
compound target, inspection evidence, outcome.

**States.** `pending`, `succeeded`, `failed`.

**Invariants.**

- I1. Exactly one `pending` intent per `recovery-required` deployment. Only
  its `succeeded` settlement releases the deployment's locks.
- I2. Settlement reads the target with a credential the executor does not
  hold (D5), rechecks the binding generation and fingerprints in one
  transaction, and records what it found as evidence. A missing record is
  never evidence that an effect did not occur.
- I3. Settlement preserves the deployment's original result and the
  environment's accepted selection. It releases ownership; it does not
  advance acceptance.
- I4. Intent creation and settlement work while the executor is unavailable.

### 4.16 Promotion tree

**Definition.** The environments of a service ordered by promotion-source
edges, with automatic flags and approval policy.

**Invariants.**

- M1. The tree is derived; it is not stored as its own object.
- M2. A `promote` deployment requires its selected set revision to be
  accepted in the source environment, with that environment's monitor
  `settled` (W3), at admission time, and rechecks on retry.

### 4.17 Acquisition intent

**Definition.** A declared desired upstream version for an acquired
component, or for a version baked into a first-party chart, recorded in Git.

**Producer.** Renovate, or a human.

**Invariants.**

- Q1. An intent is a build input: to an acquisition build when the version is
  a component, or to a chart build when the version rides inside the chart
  (K2). It is never read at deployment time.
- Q2. An intent whose acquisition fails produces no set revision and no
  deployment.

### 4.18 Prerequisite edge

**Definition.** A catalog declaration that one environment deploys only after
another environment has accepted a qualifying selection.

**Identity.** Dependent environment plus prerequisite environment.

**Attributes.** Qualification rule: `any accepted`, or `accepted at the same
or a later order key (B4) than the dependent's selection`. Commits have no
order; order keys do.

**Invariants.**

- Z1. Admission evaluates every prerequisite edge, freezes each
  prerequisite's accepted selection into the deployment, and rechecks on
  retry. Edges are evaluated at admission, never at composition, so they
  order without coupling digests.
- Z2. Edges form a directed acyclic graph across services.
- Z3. Edges replace sync waves, the root prerequisites list, and the
  site-before-edge rules. Every ordering that is a real contract today is an
  edge in the catalog. Orderings that are application compatibility (a flag
  consumer reading Flipt at startup, a snapshot consumer accepting a new
  contract before its producer) are compatibility tests, not edges.

### 4.19 Monitor

**Definition.** A declared set of alarms and an evidence threshold that an
environment must pass after acceptance before its selection counts as
settled. This is the Pipelines monitor step.

**Identity.** The accepted deployment it watches; the recipe revision
declares its content. Observations and alarms are that deployment's
evidence (V3).

**Attributes.** Alarm set (alert rule names or queries over the
observability stack and error tracker), evidence threshold (requests
served, workflows completed, probe cycles, matches processed), rollback
policy (`automatic` or `hold`).

**States, per environment.** `watching` from acceptance until the threshold
is met or an alarm fires; `settled` when the threshold is met with no alarm;
`alarmed` when an alarm fired while watching.

**Invariants.**

- W1. Acceptance starts the monitor. A selection is settled only when its
  monitor settles. An environment with no monitor declared settles on
  acceptance and is recorded as unmonitored.
- W2. An alarm while `watching` records the alarm as evidence, suppresses
  automatic selection of the alarmed set revision (D3) and, under
  `automatic` policy, creates an automatic `rollback` deployment to the last
  settled selection if D9 permits one. That rollback is authorised by a
  `restoration` approval (H5), not by a new decision. With no permitted
  candidate the environment is held (D2) for an operator with the reason.
  An alarm counts only when it became active at or after the deployment's
  claim; one already active before the claim is recorded as pre-existing
  evidence and neither rolls back nor blocks settlement.
- W3. `promote` out of an environment requires its current selection to be
  `settled`.
- W4. Thresholds are evidence counts. Where a service has no traffic signal,
  the recipe declares an active probe or synthetic transaction and counts
  its successful cycles. There is no elapsed-time threshold.
- W5. The monitor reads the same alarms an operator would be paged on. It
  does not define alarms of its own. Until the monitor reads Alertmanager, a
  silenced alert still counts as an alarm.

## 5. Target kinds

| Kind                     | Realises                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Lock scope                               | Acceptance oracle                                                                                          | Used by                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `kubernetes-application` | One Application object whose source is a chart repository at an exact revision with exact parameters. Delivery creates, updates, and deletes the Application from the recipe's full body. ArgoCD is the mechanism, under the conditions in section 8. Includes the apply-safety preflight (immutable fields, volume shrink) as a required stage.                                                                                                                                                                                                                                                                                                                                                                                                                          | the Application                          | synced and healthy, plus recipe probes, plus worker-rollout proof where declared, plus T7 where applicable | every hosted service, every upstream chart, the cluster services                                                   |
| `static-site`            | Immutable archive synced to a bucket, cache purged, entrypoints read back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | the bucket                               | entrypoint readback, HTTP 200, purge receipt                                                               | every static site                                                                                                  |
| `tofu`                   | Plan, approve where policy requires, apply one stack from one source archive and one desired-state configuration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | the stack, plus `platform` shared lock   | plan frozen, unexpired and bound to the approval, apply succeeded, state serial advanced                   | every OpenTofu stack with a remote executor                                                                        |
| `channel`                | Publish the selected artifact to an audience-facing store and point the channel at it. Sub-step one publishes the version if the store does not already have it; a published version is never removed. Sub-step two moves the channel's mutable pointer (an npm dist-tag, a GitHub release marked latest, the Obsidian community manifest, a public Docker Hub tag, a launcher or Sparkle feed). Rollback re-runs against a previously accepted selection: sub-step one is skipped because the version exists, sub-step two moves the pointer back. A store with no mutable pointer (App Store, TestFlight, Terraform registry) is a `forwardOnly` channel: the deployment is the submission, acceptance is the store serving or approving it, and D9 offers no rollback. | the channel                              | the channel serves the selected artifact with matching integrity or checksum                               | released packages, public toolchain images, the Obsidian plugin, native apps                                       |
| `operator-run`           | The same contract as `tofu` or `kubernetes-application`, executed by an attested operator tool from outside the cluster while Delivery records intent and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | as the wrapped kind                      | as the wrapped kind, operator-attested                                                                     | bootstrap chain on cold start, operator-only stacks, cluster-admission, data-layer changes of self-hosted services |
| `compound`               | Ordered sub-steps of the above under all their locks, with `pointOfNoReturn` markers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | every sub-step instance, canonical order | all sub-steps accepted                                                                                     | Scout (backend then site), TRMNL (backend then plugins), Forum (image then bundle)                                 |

There is no `node` adapter. Talos and Kubernetes upgrades are `operator-run`
deployments of the `cluster-nodes` service, one environment per node: the
operator records intent, performs the procedure by hand, and attaches the
upgrade log as attested evidence before acceptance (X13). Nothing executes
the procedure from inside the cluster. Such a recipe wraps a `host` target
rather than an Application or stack: the node's lock instance and the image
components the upgrade moves (the Talos installer and the kubelet), acquired
from the version catalog.

## 6. Flows

**First-party change.** A main-branch merge runs CI. CI registers pending
builds with their new and retained artifacts (B2 retains unchanged charts and
images). The backend verifies the pipeline succeeded, marks each build
verified, and composes an automatic set revision per service in the same
transaction, skipping services whose digests did not change (R2). Every
automatic environment of a changed service with no promotion source receives
a queued automatic deployment, subject to D3, D10, and Z1. Acceptance in a
promotion source makes the set revision eligible for `promote`, automatically
or after approval as policy says.

**Upstream change.** Renovate updates an acquisition intent. If the version is
a component, CI runs the acquisition inside the main pipeline: fetch by
digest or checksum, verify, store licensed bundles privately, register a
build of kind `acquisition` retained by the pipeline's build. If the version rides
inside a chart, the chart build reads the intent and the chart artifact
changes. From there the flow is identical to a first-party change.

**Configuration or recipe change.** A catalog PR adds a new recipe or
configuration revision as a candidate. Nothing runs. An operator or policy
requests a `rebind` deployment naming the new selection; it is admitted,
approved where required, executed, and accepted like any other deployment.

**Release to an audience.** A release is a deployment; an internal upload is
not. CI builds the package, image, or installer, stores it in the service's
artifact store, and registers the build (B6). The channel environment
(`webring/latest`, `cooklang-for-obsidian/community`,
`windows-cross-compiler/public`, `glitter-boys-launcher/stable`) then
receives an automatic or promoted `deploy` that publishes the version to the
audience-facing store if absent, moves the pointer, and reads it back. The
version bump and changelog that release-please proposes are source changes
merged like any other; the GitHub release, tag, and registry publish are
channel effects of the deployment. Today release-please performs those
inside CI, which is a build doing a deployment's job. A `forwardOnly`
channel accepts on the store's own confirmation and offers no rollback.

**Qualification.** Minecraft, the one service the repository exempts from
exhaustive CI, declares a non-durable qualification environment as the promotion source of its first
durable environment. The live set deploys there automatically; the oracle
runs the suite as deployment stages on the CI worker node and records
results as evidence; acceptance there is what makes the set revision
eligible for `promote`. Minecraft is the only consumer, by
repository policy: the extended
Paper, gameplay, all-module, load, and native-client suites that the
repository already keeps out of CI become the oracle of
`minecraft/sandbox`, and `minecraft/tsmc` promotes from it.

**Monitoring.** After acceptance, the environment's monitor watches its
alarms until the evidence threshold is met. Scout prod is the first
consumer: its monitor reads the existing Scout alert rules and error
tracker, its threshold is a count of processed matches and served Discord
interactions, and its policy is `automatic`, so an alarm during the watch
rolls back to the last settled selection without an operator. Scout beta
declares the same monitor with policy `hold`, and prod promotes only from a
settled beta.

**Rollback.** An operator asks for candidates; the API returns previously
accepted selections of that environment minus those excluded by D9, each with
its reason. The chosen `rollback` deployment restores that selection's set
revision, recipe, and configuration under the current binding generation.
Rollback of state-bearing targets is constrained by `forwardOnly` and
`pointOfNoReturn`, never by reading recipe JSON at 2am.

**Recovery.** A deployment ends `recovery-required`, by ambiguity (D5), lease
expiry (D7), or an unsettled sub-step (T3). An operator creates a recovery
intent. An independent reader inspects the target with its own credential,
records what it found, and settles. Automatic operation resumes only on
`succeeded`.

**Self-hosted upgrade.** A deployment of Delivery, its control plane,
Temporal, or ArgoCD acquires the global dispatch barrier (D8): new claims
stop, queues drain, the record is journaled off-cluster, then the effect is
applied by the outgoing executor and accepted by the incoming one reading the
frozen record. Changes to these services' data layers (their PostgreSQL
clusters) are separate `operator-run` deployments of `delivery-data` and
`temporal-data`, so an ordinary image or chart deployment can never alter
the cluster definition of the database that records it. Schema migrations
of a self-hosted service still run inside its image deployment. When
Delivery is paused, the operator-run bootstrap path of a cold start is also
how its own API, control plane and workers are upgraded.

**Cold start.** With the cluster empty, an operator runs the bootstrap tool
against the latest cold-start snapshot, which Delivery writes to off-cluster
storage on every acceptance of a bootstrap-chain environment. The tool walks
the bootstrap chain in prerequisite-edge order: node OS and Kubernetes
(attested, outside Delivery), ZFS pools (operator), ArgoCD, 1Password
Connect, OpenEBS, cert-manager, Tailscale, cloudflare-operator, ChartMuseum,
the PostgreSQL operator, SeaweedFS, restore of the artifact stores and
databases from off-cluster replicas (PC1, PC2), Woodpecker, Delivery,
Temporal, the Delivery control plane. Each is executed as `operator-run` and
sets the environment's observed selection only. Once Delivery is up, a
`reconcile-after-restore` step compares record, snapshot, and live target for
every environment and holds automatic deployments on each mismatch until an
operator accepts or rolls back with evidence. The snapshot never sets an
accepted pointer.

## 7. Fit to the inventory

Counts follow a source-only sweep of the repository with activation on;
each row states its counting rule. Scout's two frontend archives belong to
`scout-for-lol` and are not counted as static sites.

| Software class                                                                                             | Count and rule                                                                                                                                                                                                                                                                  | Service                 | Components                                                                           | Build             | Target                                                                                   | Environments                                               |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| First-party hosted service (first-party image deployed under its own Application)                          | arcade, alert-dashboard, birmel, delivery, delivery-control-plane, glitter-boys-launcher service, redlib, starlight-karma-bot, storm-brain, storm-forum, streambot, tasknotes-server, temporal, the-storm, tracker, trmnl-dashboard, woodpecker-config-extension, scout-for-lol | one per app             | image(s), chart                                                                      | ci                | kubernetes-application                                                                   | prod, or beta then prod                                    |
| Static site (standalone archive destination)                                                               | 13                                                                                                                                                                                                                                                                              | one per site            | site archive                                                                         | ci                | static-site                                                                              | prod                                                       |
| Static-site proxy                                                                                          | 1                                                                                                                                                                                                                                                                               | static-site-proxy       | image, chart                                                                         | ci                | kubernetes-application                                                                   | prod                                                       |
| Upstream chart run as-is (chart from an upstream repository, images at chart defaults)                     | 22 Applications from 24 catalog entries (`mariadb` rides inside `chart:postal`; `redis` is unused)                                                                                                                                                                              | one per chart           | chart (upstream); side resources in a companion chart or a second source             | acquisition       | kubernetes-application                                                                   | prod                                                       |
| First-party chart over acquired images                                                                     | 16                                                                                                                                                                                                                                                                              | one per app             | chart (ci); acquired image components where declared, else baked at chart build (K2) | ci, acquisition   | kubernetes-application                                                                   | prod                                                       |
| Upstream chart carrying a first-party image                                                                | openebs, velero, seaweedfs (pinchtab uses a first-party chart and belongs to the row above)                                                                                                                                                                                     | one per chart           | chart (acquisition), image (reference, A5 tracking)                                  | mixed             | kubernetes-application                                                                   | prod                                                       |
| Cluster admission (policies and bindings)                                                                  | 1                                                                                                                                                                                                                                                                               | cluster-admission       | chart                                                                                | ci                | operator-run with T7 oracle                                                              | prod                                                       |
| Cluster platform (storage classes, priority classes, CA and issuers, Kueue config)                         | 1                                                                                                                                                                                                                                                                               | cluster-platform        | chart                                                                                | ci                | kubernetes-application                                                                   | prod                                                       |
| Cluster observability (dashboards, exporters, probes)                                                      | 1                                                                                                                                                                                                                                                                               | cluster-observability   | chart                                                                                | ci                | kubernetes-application                                                                   | prod                                                       |
| Node OS (Talos) and Kubernetes version                                                                     | 2 nodes                                                                                                                                                                                                                                                                         | cluster-nodes           | installer digest, kubernetes version                                                 | attested          | operator-run (X13)                                                                       | liskov, torvalds                                           |
| OpenTofu automatic stack                                                                                   | seaweedfs, tailscale, arr, cloudflare, github, posthog                                                                                                                                                                                                                          | one per stack           | stack archive (directory plus referenced modules; desired state is configuration)    | ci                | tofu                                                                                     | prod                                                       |
| OpenTofu reviewed-plan stack                                                                               | anthropic, cloudflare-tokens, discord, openai                                                                                                                                                                                                                                   | one per stack           | stack archive                                                                        | ci                | tofu with plan-bound approval                                                            | prod                                                       |
| OpenTofu operator-only stack                                                                               | argocd, anthropic-federation, asuswrt, dockerhub, dockerhub-tokens, google                                                                                                                                                                                                      | one per stack           | stack archive                                                                        | ci                | operator-run                                                                             | prod                                                       |
| OpenTofu validate-only stack                                                                               | application-secrets                                                                                                                                                                                                                                                             | one                     | stack archive                                                                        | ci                | none                                                                                     | none                                                       |
| Self-hosted services                                                                                       | delivery, delivery-control-plane, temporal, argocd                                                                                                                                                                                                                              | as named                | image, chart                                                                         | ci or acquisition | kubernetes-application under D8                                                          | prod                                                       |
| Self-hosted data layers                                                                                    | delivery-data, temporal-data                                                                                                                                                                                                                                                    | as named                | PostgreSQL cluster definition                                                        | ci                | operator-run                                                                             | prod                                                       |
| CI runtime images                                                                                          | 1                                                                                                                                                                                                                                                                               | ci                      | ci-base, ci-playwright, cross-compiler images                                        | ci                | referenced by every recipe's runner binding (A5) and by the CI config                    | ci                                                         |
| Stateful workloads (Minecraft tsmc, Forum, media)                                                          | 3                                                                                                                                                                                                                                                                               | owning service          | image, chart, licensed bundle where applicable                                       | ci or licensed    | compound with `pointOfNoReturn`, or kubernetes-application with data-preservation oracle | prod; Minecraft adds a `qualification` sandbox before tsmc |
| Native app with a distribution channel                                                                     | glitter-boys-launcher desktop (launcher feed), tasks-for-obsidian (TestFlight, `forwardOnly`)                                                                                                                                                                                   | one per app             | installer archives, manifest                                                         | ci or attested    | channel                                                                                  | preview then stable                                        |
| Native app with no distribution today (tasknotes-macos, tasknotes-windows, scout desktop, QuotaBar, hkctl) | 5                                                                                                                                                                                                                                                                               | one per app             | installer archives                                                                   | ci or attested    | channel once a feed or track exists; none until then                                     | none yet                                                   |
| Released packages and public toolchain images                                                              | 4 npm, 1 Obsidian plugin, 3 public images                                                                                                                                                                                                                                       | one per package         | tarball, plugin archive, image                                                       | ci                | channel (npm `latest`, GitHub release, community manifest, public Docker Hub tag)        | latest; beta where a tag exists                            |
| Retired games replaced by Arcade                                                                           | pokemon, mario-kart                                                                                                                                                                                                                                                             | one per game, `retired` | none new                                                                             | none              | kubernetes-application                                                                   | retired, volumes kept                                      |
| Libraries, local CLIs, dotfiles, data packages                                                             | about 35                                                                                                                                                                                                                                                                        | not services            | none                                                                                 | none              | none                                                                                     | none                                                       |

Things the inventory forced into the model: the `attested` build kind, the
retained host set, service and environment lifecycle, `channel`,
`operator-run`, and `compound` as kinds, components per independently
selectable version with baked versions as the alternative, cross-service
artifact references in two modes, prerequisite edges, forward-only
configuration, and self-hosted deployments as a named case.

Things the model forces on the inventory: the root Application dissolves
into per-service environments and three cluster services; images frozen into
charts at publication become tracking references; upstream origin widens
from charts to images; the shared static-sites service splits into one
service per site and a proxy service, with the publisher registering one
build per site; Tofu stacks publish a stack archive and register desired
state as configuration; chart publication becomes content-addressed so
unchanged charts are retained; every sync-wave contract becomes a
prerequisite edge; runner images become components of `ci`; the data layers
of self-hosted services become separate operator-run services; the five
definition files merge into one catalog; side resources that upstream-chart
services render today (namespaces, volume claims, 1Password items,
ingresses) move into a companion chart or a second Application source owned
by the same service. Today redlib, the static proxy and ops-dashboard are
environments of `self-hosted-apps`, `static-sites` and `ops-dashboard`; they
become services at the cutover. The cutover's catalog reconcile carries each
accepted selection onto the catalog's identities: `site:<bucket>` becomes
`archive:<bucket>`, and a chart or image moves to the service that now owns
it. The carried artifacts keep their bytes, digest, URI and original build,
record the v1 artifact they stand for, and form the first set revision of
their service's lineage (R0). A `carry` deployment freezes that set
revision with the v1 acceptance's recipe and configuration and becomes the
environment's accepted selection (L1), so the selection view, promotion,
admission, the cold-start snapshot and rollback all name the carried
identities; the v1 deployment stays as it was. The v1 sync of the target
stands for the carry in a reconcile-after-restore. The carried artifacts
stay qualified for retention and rollback because their original builds
qualified.

## 8. Position on ArgoCD

GitOps and ArgoCD are separable. GitOps means Git is the source of desired
state and a reconciler pulls from it. This model replaces the source of
desired state and keeps the reconciler.

Delivery consumes from ArgoCD: sync operation identity, on which every
recovery path depends; resource health assessment, including Lua health for
operator CRDs; sync and health status as acceptance evidence; resource
tracking and pruning; and scoped API accounts. Reproducing these is the
riskiest part of the control plane and the model gains nothing from it.

The model removes from ArgoCD: Git repository sources and floating chart
ranges, the root Application and app-of-apps, auto-sync of anything but the
accepted selection, the root release workflow, chart revision injection at
publication, the delegation annotation with its ignore expressions, and the
AppProject, admission policy, and account grants that today prevent
Application creation. Delivery creates, updates, and deletes every
Application object from the recipe's full body.

Conditions under which keeping ArgoCD is the lower-risk choice, stated as
invariants of the `kubernetes-application` kind:

- Human ArgoCD accounts are read-only on Applications. Sync is an operation
  only Delivery performs.
- Delivery's independent reader (D5, I2) reads Application objects through
  the Kubernetes API with its own projected identity, not through the ArgoCD
  server, so recovery works during an ArgoCD outage or self-upgrade.
- After acceptance, Delivery sets self-heal on the frozen exact source with
  prune disabled, so drift is reverted (T4) without any floating source.

Known gap: Git kustomize sources (cloudflare-operator) have no acquisition
form yet. They need an acquisition that produces a chart or archive artifact.

Decision: ArgoCD remains the `kubernetes-application` adapter. It appears
nowhere else in the model, so a later replacement (Helm render, server-side
apply, readiness by kstatus, label-based prune, inside the Temporal executor)
changes one adapter and no primitive. Revisit if ArgoCD's health model stops
covering a workload Delivery must accept, or if the bootstrap dependency on
ArgoCD becomes the limiting factor for cold start.

## 9. Decisions

| Id  | Decision                                                                                                                                                                                                                                                                                 | Reason                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | The deployment recipe is called "recipe"; "pipeline" is not used for it.                                                                                                                                                                                                                 | The code name `Pipeline` collides with the Amazon Pipelines sense of an ordered chain of environments, which this model calls the promotion tree.                                                                                                                                                                                   |
| X2  | "Version" is not a noun in the model.                                                                                                                                                                                                                                                    | Artifacts carry version strings as metadata; identity is build plus component; bytes are identified by digest. The only numbered thing is the set revision.                                                                                                                                                                         |
| X3  | A component exists per independently selectable version; other versions ride inside an artifact.                                                                                                                                                                                         | One upstream image bump inside a first-party chart is one set revision with its own rollback where the catalog declares the image a component; elsewhere the chart is the unit.                                                                                                                                                     |
| X4  | One service per static site, plus a proxy service.                                                                                                                                                                                                                                       | Ownership, promotion, and rollback are per site. The shared service exists because one CI producer builds all sites, which is a build concern. The publisher registers one build per site.                                                                                                                                          |
| X5  | ArgoCD stays as the Kubernetes adapter under the conditions in section 8.                                                                                                                                                                                                                | Section 8.                                                                                                                                                                                                                                                                                                                          |
| X6  | The root Application dissolves; sync waves become prerequisite edges.                                                                                                                                                                                                                    | An app-of-apps is Git as the source of desired state. Ordering that is a real contract is declared, not implied by wave numbers.                                                                                                                                                                                                    |
| X7  | Bootstrap is Delivery-described and operator-executed; the snapshot lives off-cluster and sets observed, never accepted.                                                                                                                                                                 | Delivery cannot execute what must exist before it runs, but it can be the record. A snapshot that set acceptance would be a second source of truth.                                                                                                                                                                                 |
| X8  | OpenTofu stacks publish a stack archive; desired state is configuration.                                                                                                                                                                                                                 | Plan and apply bind to a selection rather than a bare commit, and a stack can be rolled back like any other service.                                                                                                                                                                                                                |
| X9  | One catalog.                                                                                                                                                                                                                                                                             | Five files describe the same services from different angles today. One definition removes the class of mismatch found in the sweep.                                                                                                                                                                                                 |
| X10 | Chart artifacts are content-addressed with the version string excluded.                                                                                                                                                                                                                  | Otherwise every merge republishes every chart and, with the root dissolved, queues a deployment per chart per commit.                                                                                                                                                                                                               |
| X11 | External registries (Docker Hub, npm, upstream chart repositories) are acceptable artifact stores for first-party and acquired artifacts alike; nothing new is mirrored except licensed bundles, and artifacts already mirrored (the Minecraft chart) stay retained under A6. Confirmed. | Mirroring would need registries the homelab does not run and an operator-only stack per repository. Reproducibility of externally stored artifacts rests on the registry's retention, stated as an accepted risk in A6 and PC1.                                                                                                     |
| X12 | A release to an audience is a deployment to a `channel`; an upload to an internal artifact store is part of the build. Stores with no mutable pointer are `forwardOnly` channels. Confirmed.                                                                                             | What makes something a deployment is that someone other than Delivery consumes the result. A stable npm version, a community plugin listing, or a public image has an audience; a private image repository or ChartMuseum is consumed only by Delivery. The published version is permanent; the channel pointer is what rolls back. |
| X13 | No `node` adapter. Talos and Kubernetes upgrades are manual, recorded as `operator-run` deployments with intent before effect and attested evidence. Confirmed.                                                                                                                          | The procedure reboots the only production node and cannot run from inside the cluster, and a few upgrades a year do not justify an adapter; recording them as deployments keeps G4 and G5 whole.                                                                                                                                    |
| X14 | The cluster baseline is three services, with admission `operator-run`.                                                                                                                                                                                                                   | A bad admission policy would otherwise block the executor that rolls it back, and a dashboard edit would share its blast radius.                                                                                                                                                                                                    |
| X15 | Monitors with automatic rollback are a primitive (4.19); Scout prod is the first consumer.                                                                                                                                                                                               | Post-acceptance alarm-driven rollback is the mechanism Amazon's Pipelines relies on most and the first draft lacked it entirely. Scout has the alert rules, error tracking, and traffic to give the monitor real evidence.                                                                                                          |
| X16 | Heavy test suites move out of CI into qualification environments (E7, V5); Minecraft is the only consumer, by repository policy.                                                                                                                                                         | The repository already keeps the extended Minecraft suites out of CI and runs them by hand. A qualification sandbox with those suites as its oracle makes them a recorded gate instead of a committer's note, and the batch scheduler already exists to run them on the CI worker node.                                             |
| X17 | CI stays incremental; charts are the remaining full-rebuild layer, closed by X10.                                                                                                                                                                                                        | Turbo runs against a changed base with the remote cache, and the image bake is scoped by affected packages with a runtime-fingerprint check that retains unchanged images. Chart publication is the one producer that republishes unchanged bytes under a new version.                                                              |

## 10. Open questions

- Which acquired images, if any, are worth declaring as components under X3
  on day one. The candidates are the ones an operator has actually wanted to
  roll back alone.
- Whether `tracking` references should be allowed to fan out across many
  consumers (the caddy proxy image is referenced by six services), or whether
  a change to such an artifact should instead be gated by a prerequisite edge
  so consumers recompose in a declared order.
- How the retained host set and non-durable environments are bounded so
  retained hosts and sandboxes cannot grow without limit.

## 11. Glossary

| Model term                | Amazon term                                            | Current code name                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog                   | package and application definitions                    | `services.json`, `platform-policy.json`, `registrations/`, `delivery-target-policy.ts`, `static-release-targets.ts`, version catalog upstream entries                                                                                                                                                                                           |
| Service                   | application (Apollo)                                   | `serviceId`                                                                                                                                                                                                                                                                                                                                     |
| Component                 | package, as a slot in a version set                    | `component`                                                                                                                                                                                                                                                                                                                                     |
| Build                     | Package Builder build                                  | `Build`; `sourceKind` `ci` / `upstream` map to `ci` / `acquisition`; `attested` is new; `licensed-bundle` becomes an origin only                                                                                                                                                                                                                |
| Artifact                  | package version                                        | `Artifact` (already keyed by build plus component); retained references are `BuildArtifactSelection` and `retainedArtifactIds`                                                                                                                                                                                                                  |
| Set revision              | version set                                            | `VersionSet`, `VersionSetEntry`                                                                                                                                                                                                                                                                                                                 |
| Recipe                    | environment definition and deployment scripts (Apollo) | `Pipeline`                                                                                                                                                                                                                                                                                                                                      |
| Configuration revision    | environment configuration                              | `configurationRevision`, `configuration`                                                                                                                                                                                                                                                                                                        |
| Selection                 | environment revision (Apollo)                          | the triple frozen on `Deployment`: `versionSetRevisionId`, `pipelineRevisionId`, `configurationRevision`                                                                                                                                                                                                                                        |
| Environment               | environment (Apollo)                                   | `Environment`; the four accepted pointers (`acceptedVersionSetRevisionId`, `acceptedPlatformDeploymentId`, `acceptedControlPlaneDeploymentId`, `acceptedForumBaselineIntentId`) collapse to one accepted selection per environment once platform and control plane are their own services; the forum baseline becomes adopted-baseline evidence |
| Retained host set         | host class membership                                  | `WorkerVersion`                                                                                                                                                                                                                                                                                                                                 |
| Target                    | host class and deployment agent                        | pipeline `kind`, `ApplicationLock`, the `shared-resources` `PlatformLock`                                                                                                                                                                                                                                                                       |
| Deployment                | deployment (Apollo)                                    | `Deployment`; `Stage` and `Outbox` are its attributes; `Request` is its idempotency record                                                                                                                                                                                                                                                      |
| Approval                  | approval step (Pipelines)                              | `Approval`                                                                                                                                                                                                                                                                                                                                      |
| Acceptance                | post-deployment validation                             | `acceptedVersionSetRevisionId` plus `Evidence`                                                                                                                                                                                                                                                                                                  |
| Recovery intent           | none                                                   | `PlatformRecoveryIntent`, `ContentRecoveryIntent`, `WorkerRecoveryIntent`, `MinecraftRecoveryIntent`, `release-lock`                                                                                                                                                                                                                            |
| Promotion tree            | pipeline (Pipelines)                                   | `promotionSourceEnvironmentId` plus `automatic`                                                                                                                                                                                                                                                                                                 |
| Acquisition intent        | none                                                   | version catalog `upstream` entry                                                                                                                                                                                                                                                                                                                |
| Prerequisite edge         | pipeline stage dependency                              | `rootPrerequisites` and stack prerequisites in `platform-policy.json`, sync waves in `application-release-policy.ts`, site-before-root checks in `static-prerequisite.ts`                                                                                                                                                                       |
| Self-hosted               | none                                                   | `delivery`, `delivery-control-plane`, `temporal`, `argocd`; the control-plane quiescence barrier                                                                                                                                                                                                                                                |
| Monitor                   | Pipelines monitor and alarm step                       | none; reads existing Prometheus alert rules and Bugsink projects                                                                                                                                                                                                                                                                                |
| Qualification environment | Pipelines test stage                                   | `mc-sandbox` in its new role; the committer-run extended Minecraft suites                                                                                                                                                                                                                                                                       |
| Omitted on purpose        | none                                                   | `ImportedSnapshot` is migration-only evidence and does not exist in the target model                                                                                                                                                                                                                                                            |

## 12. Comparison with Amazon

Based on public accounts of Brazil, version sets, Apollo, and Pipelines, and
on their public descendants CodeDeploy and CodePipeline. Internal details may
differ.

| Amazon                                                        | Here                                              | Relationship                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brazil package and Config, hermetic per-package builds        | Workspace package, one lockfile, container builds | Not modelled. The monorepo's atomic commit and single lockfile are the dependency closure.                                                                                                                                   |
| Package Builder                                               | GitHub plus Woodpecker, registering a Build       | Same role. Incremental by changed base and affected packages (X17).                                                                                                                                                          |
| Version set                                                   | Set revision                                      | The same idea in the Apollo sense: the consistent set an environment runs. Not the Brazil sense of the closure a build consumes, which the lockfile already is. One row per deployable component instead of one per package. |
| Build against a version set, with tests                       | Qualification environment (E7, V5)                | Same role: the set is exercised before it is eligible. Ours runs in an environment rather than in the build farm.                                                                                                            |
| "Merge from live"                                             | Tracking reference (A5)                           | Same, scoped to cross-service artifacts.                                                                                                                                                                                     |
| Rebuild with a known delta                                    | Not supported                                     | Builds come from main only. Manual set revisions are deploy-time hotfixes (R3). Roll-forward is the policy.                                                                                                                  |
| Apollo environment and host class                             | Environment and Target                            | Same, with hosts behind the adapter. The retained host set is the one place a host class survives.                                                                                                                           |
| Apollo environment revision                                   | Selection                                         | Same.                                                                                                                                                                                                                        |
| Apollo lifecycle scripts versioned in the package             | Chart component plus recipe                       | Same guarantee, split between the artifact and the catalog.                                                                                                                                                                  |
| Pipelines stages                                              | Promotion tree                                    | Same shape with one or two stages, plus a qualification stage where tests are heavy.                                                                                                                                         |
| Pipelines deploy actions to hosts, S3, Lambda, CloudFormation | Target kinds                                      | Same.                                                                                                                                                                                                                        |
| Pipelines approval and blocker steps                          | Approval (4.13), prerequisite edges (4.18)        | Same. Edges are for cluster plumbing only; application ordering is solved by compatible changes, as at Amazon.                                                                                                               |
| Pipelines monitors with automatic rollback                    | Monitor (4.19)                                    | Same. Evidence-gated rather than time-gated (W4).                                                                                                                                                                            |
| Bake time, one-box, waves                                     | None                                              | One node and one cluster. The monitor's evidence threshold replaces bake.                                                                                                                                                    |
| Vending third-party code into packages                        | Acquisition builds                                | Same intent with no copying. External registries are accepted artifact stores (X11).                                                                                                                                         |
| Definitions in the tools' databases                           | Catalog in Git                                    | Different by choice. Definitions stay reviewed in Git; state lives in Delivery.                                                                                                                                              |
