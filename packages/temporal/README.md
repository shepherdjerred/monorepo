# @shepherdjerred/temporal

### Delivery execution

Delivery stores release selections, immutable version sets, and audit evidence
in PostgreSQL. `deliveryDeploymentWorkflow` executes on `delivery-workflows`;
ordinary deployment Activities use the isolated `delivery` queue and worker role.
Platform and control-plane effects use the separate `delivery-platform` role.
Delivery orchestration uses the credentialless `delivery-workflows` role and
`delivery-workflows` queue in the independent control-plane Application. The
central/business `monorepo-workflows` and Scout queues remain separate.
The API and executor share the Delivery contract. Workflow IDs use the shared
`deliveryWorkflowId` helper so an acknowledged outbox row always identifies the
execution actually submitted.

Long Delivery effect Activities retain heartbeats and cancellation with a
five-minute heartbeat deadline. This tolerates a brief restart of the single
Temporal server while preserving the existing one-attempt mutation policy and
all native completion and acceptance checks.

Arcade's owned Argo sync may prune only its five retired Mario Kart/Pokebot
hostname objects. The executor verifies their absence in the frozen chart,
exact live UIDs and Argo tracking, and unchanged Application selection before
using the guarded sync command. Any other obsolete resource, including a PVC,
fails the release. Deploy this executor before selecting the hostname-removal
chart; root reconciliation preserves delegated Arcade selection.

Credential grooming uses the same guarded owned sync for the retired Recyclarr,
ChartMuseum CI and Minecraft provider `OnePasswordItem` bindings. It requires
their exact canonical replacements in the frozen chart and rechecks native
UIDs, item paths, Argo ownership and the Application source. Other obsolete
resources block pruning. Keep the 1Password items active until old consumers
have drained and the bindings and their generated Kubernetes Secrets are gone;
then archive the items without revoking credentials.

The `delivery-dispatch` Schedule qualifies published builds against their exact
terminal CI execution, reconciles automatic environment selections, and submits
unacknowledged outbox rows. It starts paused until the service, executor
credentials, and compatible Workflow workers are available. A lost start
response is inspected by stable Workflow identity before acknowledging the row.
Paused or occupied environments remain in a durable Workflow admission wait.

A self-hosted service's model deployment hands off after its steps apply (D8):
the executor marks it handed off and stops without accepting it. The next
dispatch tick starts its one successor, `deliveryHandoffWorkflow` with ID
`deliverySuccessorWorkflowId`, instead of treating the closed Workflow as an
orphan. The successor claims the marker before anything else, then verifies
acceptance and finishes. A refused claim changes nothing; an unverified
successor finishes recovery-required with the locks and barrier held.
Histories recorded before `delivery-self-hosted-handoff-v1` accept as before.

The sync that applies a self-hosted change can replace the Delivery worker
running it. The SDK cancels that Activity with `WORKER_SHUTDOWN`, which kills
the guarded Argo command; while the lease is still held the step fails as
`DeliveryExecutorReplaced` with its stage left `running`, and the Workflow
renews the lease and runs the same step on the replacement worker. Because the
request already reached the Application, that attempt only reads it back (or
adopts the live matching operation through the guarded command) and settles the
stage, so the deployment hands off instead of ending recovery-required. A
Failed owned operation, a refused or failed guarded command, a lost lease, a
requested cancellation, an ordinary deployment, and a fourth consecutive
replacement of one step still fail as before. The classification runs on the
outgoing worker, so it applies once the running Delivery worker carries it;
histories recorded before `delivery-executor-replaced-resume-v1` finish
failed as they did.

`scripts/rollout/delivery-settlement-recovery.ts` provides independent result
settlement when an unavailable executor cannot finish its recorded result.
Its required arguments are `--deployment`, `--run`, `--activity`, `--url`, and
`--mode preview|execute`, with explicit `TEMPORAL_ADDRESS`/`TEMPORAL_TLS` bootstrap.
It requires paused, drained dispatch and runs only the canonical `finishDelivery`
Activity on a private, resumable queue bound to the original run and inputs.
It preserves the recorded outcome and quarantine. Successful inputs must exactly
match completed acceptance Activities in the same history, and the canonical
API acceptance checks still run. Native recovery remains a separate operation.

TRMNL plugin configuration is a fixed dependency stage of the
`trmnl-dashboard` release, after its backend image and health are verified.
CI publishes the original qualified `archive:trmnl-plugins` JSON bundle; it
does not publish plugins to TRMNL. The executor verifies its content hash,
original source revision, six source basenames, settings IDs and the three
reviewed plugin targets. Each POST has a persisted per-plugin intent and a
fresh held claim. GET readback before retry and after publication compares
all source-owned settings and exact Liquid bytes; API-managed settings may
remain. An ambiguous response retains the failed result and ownership.

The ordinary worker and API observer receive only the dedicated plugin key
and prefix-only `delivery-artifacts/trmnl-plugins/*` archive reader. Although
the observer sends GET requests only, the upstream plugin key itself permits
writes. It is separate from the dashboard's runtime credentials and grants
no Home Assistant access. No TRMNL key is projected into CI.

For a partial plugin publication, request an explicit repair of the failed
owner. This freezes the same version set and bundle, transfers its held lock
only after independently proving the original Workflow is closed, and
rechecks that proof before every POST. Repair inspects the original owned
Argo operation, ready backend image and health before and after effects. It
does not select or synchronize Argo, change application acceptance, or rewrite
the original failed result. All three readbacks must match before unlocking:

```bash
toolkit deploy trmnl repair FAILED_DEPLOYMENT_ID --machine --expected-generation CURRENT_GENERATION --request-id UNIQUE_REQUEST_ID --reason 'Repair the exact frozen plugin bundle after interrupted publication'
```

When the Workflow/Activity worker is unavailable, the same effect engine can
run in the foreground. Delivery API/PostgreSQL, Temporal server, Argo and the
two external APIs must remain reachable. First pause `delivery-dispatch` and
wait until its current action has completed; inspect or terminate a running
repair Workflow before taking its work. The command refuses an active repair
Workflow or an unpaused/undrained dispatcher. Create the repair above after
pausing, then run:

```bash
toolkit temporal --namespace prod schedule toggle --pause --schedule-id delivery-dispatch --reason 'Independent fixed TRMNL repair under held quarantine'
toolkit temporal --namespace prod schedule describe --schedule-id delivery-dispatch
bun packages/temporal/scripts/rollout/trmnl-delivery-repair.ts --deployment REPAIR_DEPLOYMENT_ID --url DELIVERY_URL
toolkit temporal --namespace prod schedule toggle --unpause --schedule-id delivery-dispatch --reason 'Fixed plugin readbacks verified and repair completed'
```

The operator command brokers the existing executor, Argo, Temporal and narrow
TRMNL credentials without printing values. A failed repair retains quarantine;
inspect it and request another explicit repair rather than releasing its lock.
This path has local protocol and Workflow evidence; no live plugin POST or
production outage exercise has been performed as part of implementation.
Dispatch repair also inspects submitted requests and records a failed request
when its Workflow closed before settlement; ambiguous external stages retain
their target lock.

Licensed forum acquisition is qualified independently of CI availability. The API
reads exact private bytes against the neutral dependency policy at the original
producer commit; genuine CI later retains that qualified artifact. The dispatcher
also starts `deliveryForumBaselineWorkflow` for explicit admin intents. It only
requests API-owned native observations and records an immutable failure or original
baseline. The first upgrade freezes that baseline and rechecks the original before
candidate source selection; subsequent upgrades use accepted application provenance.
Neither baseline nor ordinary rollback can reverse database migrations.
Forum's original guarded sync prunes only independently verified terminal prior
release Jobs omitted by the exact selected chart. Active, foreign, hook or
unrelated resources refuse pruning. Completed release journals and backup
manifests remain on their existing storage; acceptance still requires genuine
Synced/Healthy status and the same original owned operation.

The Argo adapter verifies published chart bytes, selects exact source fields
with optimistic concurrency, and invokes the existing guarded `sync-managed`
command. After the owned sync succeeds, verification uses a bounded series of
status readbacks without repeating native effects. Every read retains the deployment,
selection, Application UID and owned-operation fences; final acceptance still
requires genuine `Synced` and `Healthy` status. Acceptance also requires exact deployment
history, ready running image digests, and configured runtime checks. Release
mutations have one Activity attempt. An ambiguous failure retains the
environment lock until an operator inspects the recorded external operation and
explicitly releases it with evidence through Delivery.

The ordinary Delivery role also receives its existing scoped registry reader.
An alternate CRI index is accepted only after immutable registry bytes prove the
complete qualified runnable descriptor set and the running config; differences
must be positively identified attestation descriptors. Artifact records stay immutable.

The production image bundles the guarded Argo command. A missing bundle fails
instead of selecting another implementation. Development runs the source
command. PostgreSQL, Temporal and ArgoCD recovery remain available through their
existing operator tools without requiring a healthy Delivery executor.

The bounded worker proof Job runner targets `delivery-worker-jobs`
and Delivery's reserved Kueue slot on liskov, which platform Jobs share. A
source-owned recipe controls the command,
credential keys, resources, and checkout. The executor records the exact Job
UID and canonical request fingerprint before waiting, and inspects an existing
Job before creating one. Ordinary stage Pods have no Kubernetes or vault token.
Worker proof Jobs project only registry-read credentials and fixed
Temporal/metrics access. The separate `delivery-platform` Activity role uses
`delivery-platform-jobs`. Its Job-create authority intentionally includes every
managed provider credential projected in that namespace: fixed child recipes
limit normal execution, but do not isolate those credentials from a compromised
platform worker. The ordinary Delivery worker cannot create Jobs there.
Platform capability registration remains inactive until reviewed provisioning.
Only fixed platform recovery recipes mount `delivery-recovery-inspector`:
that account can read Jobs and list/read Pods in `delivery-platform-jobs` only.
It cannot create resources, execute commands in Pods, read Secrets or use cluster
permissions. Its projected token lets the independent native verifier repeat
terminal-executor observations immediately before a recovery mutation.

Every stage Job prepares its workspace in an emptyDir on liskov's OS disk, so
the bootstrap writes as little as it can. It links the CI image's mise
toolchain instead of copying it, and copies only mise's per-tool metadata, so a
missing tool version still installs beside the image's. Image provenance
installs only the Temporal workspace's production dependencies. A worker
candidate at the executor's own revision reuses the prepared checkout. Any other
candidate is a detached worktree with a blobless fetch into the executor's
object store, sharing the Job's Bun cache. Candidate `mise exec` never
auto-installs tools that the unprivileged Job cannot read from the image, such
as Rust. Adoption and recovery accept only the current bootstrap and the exact
earlier ones listed in `PREVIOUS_DELIVERY_JOB_BOOTSTRAPS`. Every other pod field
is still compared.

Platform releases freeze qualified source builds and the complete original
chart inventory. Root mutations reuse `release-root`; central must first be
delegated so root cannot change its protected control-plane templates.
Delivery invokes that same canonical root library directly and repeats its
existing PostgreSQL/native admission before staging, child reconciliation and
finalization. The admission binds the frozen request, exact chart inventory,
generation and recorded native Job identity; a newer chart publication cannot
replace a still-owned selection or recovery. Standalone CLI releases retain
their published-latest check. Both paths retain the same lifecycle, immutable
field, request ownership, pruning and verified release receipt checks.
OpenTofu planning and applying are separate Deployments. Plans capture state
lineage and serial, action counts, native Job UID, and the exact source build.
The bounded saved plan is encrypted with the dedicated
`DELIVERY_PLAN_ENCRYPTION_PASSPHRASE` credential and stored behind execute-only
API endpoints. Apply checks the frozen metadata, authentication tag, expiry and
current state, then applies that saved file without replanning. Existing
sensitive stack policies require approval of the exact plan; routine stacks
retain automatic execution after their prerequisites. Provider subprocesses
receive their declared stack credentials, excluding the Delivery API token.

Worker releases freeze an environment-owned PostgreSQL pool into each
Deployment. Only the reviewed central and Scout host profiles are allowed;
pool entries select immutable original image artifacts and zero or one replica.
Central hosts serve both `prod` and `beta`. Their rollout plan records both
namespaces, and each explicit routing step checks both. Replay, exact image
identity, pinned canaries, healthy pollers and beta prerequisites precede direct
promotion. A normally routed canary then verifies each namespace. There are no
fixed traffic bake periods; original hosts remain until independent drainage
proof permits retirement. A partial routing response is inspected before
repeating the same step.

A model recipe's `worker-rollout` step runs the same Jobs. Its apply-safety
step first proves every retained image's Build ID and the served routes, and
refuses a pool that still has legacy pollers. Only then does it write the
Application, whose sync renders the retained-host pool. The step itself records
its intent, proves every host, then records the preflight's routing plan as
evidence before promoting and verifying. A resumed step routes by that recorded
plan and reattaches to any Job whose stage is already recorded.

A `retire-host` deployment of a model recipe runs only the worker
Application's apply-safety, sync, `worker-rollout` and oracle suite steps; it
re-selects the accepted set revision, so it activates no site or plugin
archive. Apply-safety and sync each submit a fresh drainage and routing proof
to the deployment's claim immediately before writing the body and before
syncing it, as the v1 executor does before its sync. The sync renders the
retiring host at zero replicas. The `worker-rollout` step then promotes
nothing: it reads the hosts back until the retired host has no Pod and every
retained host is ready with healthy pollers, and proves every served route
still reaches a retained host.

A compound recipe, such as TSMC's companion and server, runs its sub-recipes'
steps in recipe order under one deployment and one lease. Each step key is
prefixed with its sub-recipe's position (`sub2-step-sync`). A model
`minecraft-upgrade` step restarts the retained world volume after the sync and
reads back that the server runs exactly `repository:version@digest`. Historical
`verified-restore` rows take the same path; scheduled Velero backups are the
only backup.

Before that sync, the server sub-recipe's `players-offline` step runs
`rcon-cli list` in `minecraft-tsmc-0`. The Delivery worker holds a Role
limited to that pod for this. The public Query feed omits hidden staff, so the
gate reads the console instead. A sleeping or unready server counts as empty.
While anyone is connected, or the console does not answer, the step waits and
asks again each tick. An unknown reply fails it.

Rollbacks of TSMC stay refused.

A `channel` recipe freezes two steps, and only the npm store has an adapter
so far; any other store stops as a missing adapter. Both steps authenticate
with `NPM_TOKEN` from the Delivery worker's npm channel item.

- `step-publish` publishes the selected tarball under the `delivery-staged`
  dist-tag, but only if the registry lacks that version. It reads the
  tarball from the Delivery artifact store and verifies its digest first. It
  then reads back until the registry serves bytes whose sha256 matches the
  artifact.
- `step-pointer` moves the channel's dist-tag, such as `latest`, reads back
  that the tag resolves to the version, and drops the staging tag.

The registry's integrity and shasum are recorded as evidence. A published
version is never replaced: different bytes under the same version stop the
deployment. A rollback finds its version present and only moves the pointer.

Poller proofs make bounded exact-build instant readbacks when active polling
briefly reaches zero; success requires a fresh positive result, and query or
schema errors fail immediately.

Worker Jobs invoke the native Temporal CLI only for the fixed in-cluster
plaintext endpoint, with environment and file configuration disabled. This
prevents ambient API-key or TLS settings from changing that connection and
requires no vault access. External operator endpoints retain toolkit's
credential broker and explicit namespace/transport selection.

First ownership transfer uses a separate owned Argo bootstrap operation. It
keeps every legacy replica while creating retained hosts, and refuses any
legacy digest without qualified original-artifact coverage. Exact replacement
Pod images and healthy pollers on every served route must pass before the
final owned operation can scale legacy hosts to zero. Shared application roles
use the selected candidate image. The Delivery executor, Minecraft controller
and isolated platform worker belong to the separate `delivery-control-plane`
chart and Application. Application rollbacks never render those resources.
Their original Temporal image artifact remains an explicit cross-service
reference selected in PostgreSQL. Ordinary central releases render the exact
chart and reject historical archives that contain protected control-plane
workloads. Image equality alone could not protect commands, probes, credentials
or other template fields across application rollback.

Both Flipt-consuming control-plane Activity roles export telemetry through the
internal OTLP collector. Their exporter bootstrap and collector egress belong
to the control-plane chart, so changing them uses the same independent upgrade
path, including chart-only upgrades that retain the original Temporal image.

The current catalog's `delivery-control-plane/2` recipe uses an ordinary owned
Application release. Its image tracks the original artifact accepted by
`temporal/prod`, so a chart-only release can retain the previous worker image
until that parent accepts its replacement. Verify the controller's actual image
before relying on new executor behavior or provider grants.

For a legacy `control-plane` recipe, an admin intent freezes the controller chart and original Temporal
image independently, including chart-only upgrades that retain older image
provenance. Its claim waits for every other Delivery execution and recovery to
settle, then blocks new claims while the independent platform Job runs. That
Job verifies the prior source, templates and ready Pods, applies the owned
selection with `sync-managed`, and independently observes the finished operation
and every new controller Pod. A different image must carry the immutable
`red.sjer.delivery.control-plane=delivery-control-plane/v2` OCI capability label
on every runnable platform, including the original baked image source SHA.
Pause the dispatch Schedule and drain other pending releases, baselines and
recoveries before requesting this upgrade. Inspect the returned deployment ID
and start its exact stable Workflow while dispatch remains paused:

```bash
toolkit temporal --namespace prod workflow start --workflow-id delivery/ACTUAL_DEPLOYMENT_ID --type deliveryDeploymentWorkflow --task-queue delivery-workflows --input '{"deploymentId":"ACTUAL_DEPLOYMENT_ID"}'
```

Read back that run before retrying; never substitute a new Workflow ID.
The independent Job journals the
ordinary Activity Deployment UID, template fingerprint and owned Pod UIDs,
stops that exact host with a resource-version/replica CAS, and waits for its
processes to disappear. Platform execution and the Workflow poller remain alive.
It verifies the dedicated queue has only its own exact open run, builds the
qualified candidate image's immutable original source with frozen dependencies,
and runs the real Node SDK replay against that run's complete history. Chart
source and retained image source may differ. A fresh history fingerprint,
paused Schedule, native templates, replica counts and stopped-process proof
must still match immediately before selection. A mismatch leaves source
unselected and restores only the same prior UID/template to one replica;
crash recovery uses the durable journal. No success can retain a stopped host.
The three steady roles request 300m CPU and 768 MiB total, with combined limits
of 3 CPU and 3 GiB; the optional Minecraft controller has its separate budget.
Activity replacement resumes only the same persisted native Job UID and frozen
fingerprint; a missing or replaced Job retains quarantine. Success advances
the control-plane acceptance pointer without accepting an application release.
The source bootstrap and platform ownership registries remain inactive pending
reviewed provisioning and live acceptance.

Platform recovery preserves the failed Deployment and its held quarantine. A
separate admin intent freezes that identity. Its independent native recipe
rechecks the closed original Workflow, every recorded Job UID/spec fingerprint,
and terminal owned executor Pods, including earlier recovery attempts. An absent
Job never proves absence of effects. Completion requires a fresh complete target
inspection and the original generation/snapshot/lock CAS. Root recovery verifies
the durable owned root termination and every frozen child source and health.
Only that receipt-bound root observation permits aggregated `Progressing` health;
each frozen child must still be `Synced` and `Healthy`. A legacy floating root
source never replaces the receipt's immutable selected revision. Root chart
templates pin their own Application to the selected chart's exact version, so
later artifact publication cannot retarget the active root Application.
Controller recovery verifies the exact prior or desired chart, full Pod templates
and original runtime image digests. Desired controller settlement also requires
the original owned finished Argo operation. No failed release becomes accepted.

The same verifier runs without a healthy Workflow or Activity worker, while
Delivery API, PostgreSQL, Kubernetes and the Temporal server remain reachable.
From the repository root, create and inspect the intent using the brokered admin
identity, then run the bounded operator command:

```bash
toolkit deploy platform recover DEPLOYMENT_ID --machine --expected-generation GENERATION --reason 'Independently settle this exact failed platform operation'
toolkit deploy platform recovery RECOVERY_INTENT_ID
bun packages/temporal/scripts/rollout/platform-delivery-recovery.ts --intent RECOVERY_INTENT_ID --url DELIVERY_URL --context admin@torvalds --action inspect
```

If a root release is partial, `--action apply` reruns the existing guarded
`release-root` with its original request UUID and frozen inventory. For a
controller release it can synchronize only the already selected exact desired
source; it cannot select another chart or image. A pre-selection failure can be
settled by observing the unchanged healthy prior source instead.

Before manual settlement, pause the existing `delivery-dispatch` Schedule and
wait for its running dispatch Workflow to close. Create a fresh recovery intent
only after dispatch is quiet, so automatic read-only inspection cannot close it
while a human reviews the plan. An automated inspection that finds a partial
target fails its intent and preserves quarantine; it never applies changes.

```bash
toolkit temporal --namespace prod schedule toggle --pause --schedule-id delivery-dispatch --reason 'Manual platform recovery under held quarantine'
toolkit temporal --namespace prod schedule describe --schedule-id delivery-dispatch
toolkit temporal --namespace prod workflow list --query 'WorkflowType = "deliveryDispatchWorkflow" AND ExecutionStatus = "Running"'
```

A partial OpenTofu apply remains quarantined until a new recovery plan is saved
from the original source/stack and current native state. The plan has its own
honest recovery-intent identity and native Job receipt, encrypted bytes, expiry,
digest and state lineage/serial. For an existing reviewed-plan stack, a trusted
human must approve the displayed exact plan fingerprint; a machine admin cannot
approve it. Routine stacks retain their existing automatic policy.

```bash
bun packages/temporal/scripts/rollout/platform-delivery-recovery.ts --intent RECOVERY_INTENT_ID --url DELIVERY_URL --context admin@torvalds --action plan
toolkit deploy platform recovery RECOVERY_INTENT_ID
toolkit deploy platform recovery-approve RECOVERY_INTENT_ID --plan-fingerprint EXACT_PLAN_FINGERPRINT --decision approved --reason 'Reviewed exact recovery plan and native state'
bun packages/temporal/scripts/rollout/platform-delivery-recovery.ts --intent RECOVERY_INTENT_ID --url DELIVERY_URL --context admin@torvalds --action apply
bun packages/temporal/scripts/rollout/platform-delivery-recovery.ts --intent RECOVERY_INTENT_ID --url DELIVERY_URL --context admin@torvalds --action inspect
```

Apply authenticates the saved bytes and current state, checkpoints its own native
UID, renews admission, and excludes the API credential from the provider child.
The final inspection requires a no-change plan at the frozen source and stable
state. It alone releases quarantine. A missing/replaced apply Job is never
recreated; inspect its exact receipt and use a new admin intent if needed.

For an interrupted root attempt,
`--action inspect-stopped-root` runs the reviewed host source instead of the
failed Job's frozen source. It verifies terminal original native executors, a
closed Workflow, the owned frozen root operation and every rendered
Application's stable UID/source/lifecycle. Typed stopped settlement records
partial health and clears only stale ownership; it preserves the failed result
and accepts no root. An existing accepted root keeps its original pointer and
frozen snapshot; its historical receipt must still match that exact prior.
A corrected independently qualified API must support this
outcome before using the host command; the next corrected root still follows
normal exact-source `release-root`.

```bash
toolkit temporal --namespace prod schedule toggle --unpause --schedule-id delivery-dispatch --reason 'Independent platform recovery verified and quarantine settled'
```

Static archive activation is delegated by the reviewed bucket ownership map:
thirteen independent sites and both Scout frontend stages use their exact
registered environments. These buckets require immutable artifact publication
and cannot fall back to a legacy writer; unknown or mismatched owners refuse.

Static archives and Forum releases use a foreground maintenance command rather
than an automatic recovery worker. Pause `delivery-dispatch`, wait for every open
Delivery Workflow and original native Job/Pod to finish, and request a content
recovery intent with `toolkit deploy sites recover` or `toolkit deploy forum
recover`. The command checkpoints and stops the exact ordinary Activity host;
do not scale it down before the first invocation. API/PostgreSQL, ArgoCD,
Kubernetes and the Temporal server must remain reachable. A loopback-only
Temporal port-forward supports a worker outage without exporting a server key:

```bash
kubectl --context admin@torvalds -n temporal port-forward service/temporal-temporal-server-service 17233:7233 --address 127.0.0.1
```

In a second terminal:

```bash
env -u TEMPORAL_API_KEY TEMPORAL_ADDRESS=127.0.0.1:17233 TEMPORAL_TLS=false bun packages/temporal/scripts/rollout/content-delivery-recovery.ts --intent RECOVERY_INTENT_ID --url DELIVERY_URL --context admin@torvalds --action repair
```

The existing credential broker resolves the scoped executor, local operator
Argo identity and, only for static targets, the registered static activator and
cache-purge fields. It never substitutes the broad Cloudflare operator token.
Static repair reapplies the frozen archive then independently checks bucket and
public bytes; Scout also requires its exact healthy backend and settled worker
routes. Forum repair copies the original Job under the operator's existing
Kubernetes authority, preserves its image/environment/volumes, and checkpoints
the suspended child before admission. No new service account or delegated
cluster authority is installed. Only journaled idempotent steps may repeat;
uncertain installation, add-on or content/account migration remains locked for
native inspection with the original backup. If the failed historical Job keeps
the web wave pending, the command prints the exact selective-sync instruction
for the already selected web Deployment and requires the same intent to be
rerun. It never changes an Argo source or restores a production database.

For an interrupted non-repeatable Forum step, `inspect` reports its step and
exact journal SHA256. Follow the Forum package's manual repair procedure while
the same maintenance owner and original backup remain held. After the native
operation is independently complete and its operator Pod has terminated, use:

```bash
bun packages/temporal/scripts/rollout/content-delivery-recovery.ts --intent RECOVERY_INTENT_ID --url DELIVERY_URL --context admin@torvalds --action repair --acknowledge-step STEP --expected-journal-sha256 EXACT_JOURNAL_SHA256
```

The fixed read-only verifier must prove that exact step complete. The command
appends only that checkpoint, never replays it, and then continues the original
approved candidate. A changed journal, incomplete native migration or foreign
owner refuses without removing maintenance or replacing the original backup.

`--action inspect` verifies an already settled target without replaying its
repair. Fresh native/target readback and the original PostgreSQL generation/lock
CAS release quarantine without accepting the failed release. The same command
resumes a settled intent whose exact host restoration acknowledgement was lost.
It restores only that host's UID/template and new Ready Pods. Stop the exact
port-forward and resume dispatch after the restoration receipt is recorded.

If Delivery API or PostgreSQL is unavailable, restore availability before these
commands. Keep dispatch paused and stop new release authority. Inspect the
already selected sources and database without selecting another release:

```bash
kubectl --context admin@torvalds -n argocd get applications delivery delivery-control-plane -o custom-columns='NAME:.metadata.name,CHART:.spec.source.chart,REVISION:.spec.source.targetRevision'
kubectl --context admin@torvalds -n delivery get postgresql delivery-postgresql
kubectl --context admin@torvalds -n delivery get pods,persistentvolumeclaims
kubectl --context admin@torvalds -n velero get backups -o custom-columns='NAME:.metadata.name,PHASE:.status.phase,ERRORS:.status.errors,WARNINGS:.status.warnings'
```

For an intact catalog, the existing guarded infrastructure command can reconcile
only its already selected source. Use the recorded operation request UUID when
one exists. Broker the registered workload Argo credential through the existing
service-account wrapper, and strip vault access from the child:

```bash
ARGOCD_TOKEN=op://v64ocnykdqju4ui6j6pua56xw4/w7rrmm6v2agx7jk4qjsaybxaau/ARGOCD_TOKEN scripts/onepassword/with-service-account.sh op run -- env -u OP_SERVICE_ACCOUNT_TOKEN bun packages/homelab/scripts/argocd/argocd.ts sync-managed delivery --revision ALREADY_SELECTED_REVISION --request-id RECORDED_OR_NEW_REQUEST_UUID
```

For `delivery-control-plane`, use the platform credential
`op://v64ocnykdqju4ui6j6pua56xw4/orpriiyv36sxmybxe3fg4szdxq/ARGOCD_TOKEN`
with the same guarded command only after catalog integrity is established.
It restores the already selected native resources; it neither
changes PostgreSQL selection nor releases a lock. The root release and guarded
sync commands remain independent infrastructure recovery tools after CI stops
deploying workloads.

For damaged or missing data, stop every API writer and restore the Delivery
PostgreSQL volume from Velero's scheduled backups, which are the only backup,
with the
[PostgreSQL operator how-to](../docs/wiki/src/content/docs/how-to/upgrade-a-homelab-postgresql-major-version.md).
Then reconcile the API at its captured source and inspect actual Temporal,
native Job and Argo identities against restored records before resuming
submissions. A stale backup cannot justify accepting releases or clearing
quarantine.

Central's explicitly reviewed `caddy-s3proxy` sidecar stays an immutable chart
dependency; acceptance checks its ready Pods against the selected chart's
manifests. Unknown first-party dependencies fail source generation.

Retirement is another locked Deployment, with a frozen zero-replica snapshot.
Admission and source selection recheck PostgreSQL references and every served
namespace: the build must be neither current nor ramping, drainage must follow
its last deactivation, and exact visibility must report zero open executions.
Routing conflict tokens are read twice. Retirement keeps image provenance and
historical snapshots, and acceptance waits for retired Pods to disappear.
Resource deletion remains a separate guarded pruning operation. Prepared
definitions do not activate source delegation or live worker credentials.

Host-only `adopt-worker` requests independently observe original image build IDs,
ready Pods and every served route before materializing a baseline pool. They
never advance application acceptance pointers. Worker recovery uses a separate
immutable intent: the read-only verifier checks closed source execution, exact
terminal native Jobs, stable routing, captured source identity and live hosts,
then releases the held lock through a fresh generation CAS. The original failed
result and pool remain unchanged. The verifier reads the Application, Deployments
and Pods from the Delivery API's own readers, never the executor's ArgoCD token.
A model worker deployment is classified by its frozen recipe: its step keys,
`subN-` prefixed in a compound recipe, and the fixed sub-stages of the worker
Jobs. A requested sync is proved against the recipe's chart selection, an
unsynced apply-safety must leave the original hosts serving, and routing must
follow the plan the worker preflight recorded. A sync this deployment owns that
Argo ended `Failed` or `Error`, with no later step recorded, settles when the
Application still holds the rendered body, no route serves the candidate, no
execution references it, and every retained host runs its exact image. The
candidate host may exist; the next deployment replaces it. Any other stage, or
an unsettled step of another sub-recipe, fails closed.
`scripts/rollout/worker-delivery-recovery.ts` runs the same verifier through
brokered operator credentials when Activity workers are unavailable; it never
resumes effects or accepts the failed release.

TSMC releases restart the retained world PVC through owned Argo reconciliation
and exact Ready image checks. Scheduled Velero backups are the only backup.
Open Workflow histories that already scheduled preservation or recovery
dispatch keep those commands; the activities fail closed and do not take or
restore a volume.

The cutover uses one coordinated maintenance window: stop legacy CI release
authority, bootstrap the API and independent control-plane chart, register the
actual qualified current state, and transfer reviewed ownership before resuming
submissions. Empty source registries leave the existing live owners unchanged
until that window. Woodpecker's final role is verification, builds, immutable
artifact publication and provenance; release selection and execution belong to
Delivery. Remove pending deployment pin updates and legacy deployment flows as
part of that cutover, rather than leaving two permanent release owners.

Temporal workflow worker for the monorepo. It consolidates what used to be K8s
CronJobs, in-process cron, and custom job queues into one durable, observable
scheduler: declarative schedules (home automation, reports, maintenance),
generic report-only Codex SDK agent tasks on an OpenAI project key, including the daily
homelab audit, deterministic PR-opening refresh jobs, and webhook ingress
(GitHub merge-conflict check and build cancel, Xcode Cloud, iOS sleep).
Closed PR cleanup matches Woodpecker pull-request refs or source-branch pushes
at the exact head commit before cancelling active jobs.

The existing five-minute CI cache maintenance schedule also collects the
separate main and PR source caches on Liskov. Its activity acquires the clone
helper's exclusive GC lock, retains seven days, and trims each data claim to
8 GiB. It preserves active readers and emits its own maintenance outcome.

### CI maintenance dispatch

The `ci-maintenance-dispatch` schedule runs every five minutes in `prod` with
SKIP overlap and a five-minute catchup window. Its bounded tick wakes the
durable `ci-maintenance-coordinator` on `monorepo-workflows`. All GitHub and
Woodpecker I/O runs on `repo-automation`. The production inventory enables
`ci-maintenance-dispatch-enabled`; its runtime fallback remains off.
Registration creates this schedule
paused because older stable workers do not register `runCiMaintenanceTick`.
After candidate promotion and both manual maintenance canaries pass, enable the
dispatch flag and unpause this exact schedule. Reconciliation preserves the
operator's subsequent pause state.

Describe the workflow and read its `ciMaintenance` memo for the pending request ID, pipeline receipt,
completed fingerprints, and blocked streams. The coordinator allows one
submission at a time, coalesces repeated ticks, and retains fingerprints
across worker replacement and continue-as-new. The memo is refreshed after
each tick; Workflow history records in-flight writes before that snapshot.
CI image fingerprints cover
the tool manifest, lockfile, and Dockerfiles. Ready generated PRs freeze their stream.

Active manual runs on the owner's `ci-canary/` branches defer automatic maintenance so their
measurements do not compete with its I/O. Admission queries active manual statuses
across branches within a shared ten-second deadline and checks again immediately
before submission. A full active-status page defers maintenance conservatively;
completed history cannot hide an active canary. Receipt reconciliation keeps its
separate bounded main history query. Terminal canaries
release this hold naturally; the schedule remains unpaused. Other CI can still
arrive after admission, so benchmark collectors must verify isolation throughout.

The optional `workspace-seeds` stream uses the verified main SHA as its
fingerprint and is gated separately by `ci-workspace-seed-refresh-enabled`
(production default off). It uses the existing coordinator and schedule,
publishing verify and browser profiles in ordered containers. Its final
`workspace-seeds-result` command emits the unique maintenance receipt only
after both profiles finish. Capacity deferral leaves the fingerprint pending
for a later tick. The extension's workspace-cache reference documents the
immutable generation and reader-lock contract.

Qualify seeds through an owner-triggered manual `workspace-seeds` pipeline
before enabling automatic refresh. The dispatcher and its repo-automation
worker run in `prod`; the producer flag is an explicit production control.
Canary branches target beta consumer flags and do not require a beta dispatcher.

Writes have one activity attempt. After a lost response, subsequent ticks
search for the recorded request ID; they never repeat the POST blindly.
Read failures preserve state. A failed pipeline blocks that stream until an
operator inspects it and sends `maintenanceRetry` with its exact `kind` and
`requestId`. The other stream may continue. An absent submission requires an
API/history audit first: send `maintenanceConfirmAbsent` with its exact
`requestId` and a non-secret `evidence` explanation, then explicitly retry.
That signal cannot clear a request with a known pipeline receipt. Never
confirm absence while the original request or pipeline could still settle.

`toolkit ci maintenance --json` lists recent maintenance receipts separately
from verification. A successful maintenance run must emit one structured
result, either completed or deferred for a ready PR. Deferred work does not
advance its completed fingerprint. Main verification requires the complete
release graph and cannot be cleared by a maintenance-only manual run.

### Nightly extended verify

The `ci-extended-verify-nightly` schedule runs `runCiExtendedVerifyWorkflow`
at 02:00 America/Los_Angeles in `prod` with SKIP overlap, the default
one-hour catchup window and a four-hour execution timeout. The Workflow runs on
`monorepo-workflows`; its Woodpecker reads and the single write run on
`repo-automation`. It selects the newest complete main build (the same
`newestVerifiedMaintenanceSource` the coordinator uses), then POSTs one manual
`main` pipeline with message `ci-extended-verify/<request-uuid>` and variables
`CI_EXTENDED_REQUEST` and `CI_EXTENDED_SOURCE`. The config extension emits the
`verify-extended` workflow for that request, or an `extended-superseded`
no-work step when main's verified head moved first. The message is not a
`ci-maintenance/` message, so maintenance admission ignores the nightly run.

The write has one attempt. A lost response is read back by request ID after a
minute and never resubmitted; no receipt fails the Workflow for operator
review. While a `ci-canary/` run or maintenance pipeline is active the
submission is deferred in ten-minute steps, up to an hour, so canary
measurements are not skewed. The Workflow then polls the pipeline every two
minutes and refreshes its `ciExtendedVerify` memo (request ID, source,
pipeline number and URL, status, observation) on every tick.

A red pipeline fails the Workflow with `ApplicationFailure.nonRetryable`
naming the pipeline number, URL and failed workflows; `temporal-failure-watch`
turns that into the usual Alertmanager occurrence, so there is no bespoke
alert path. The dispatch flag `ci-extended-verify-dispatch-enabled` off, no
verified source, an hour of deferral or a superseded source end the run as
`skipped`, never failed. Registration creates the schedule paused because
older stable workers do not register `runCiExtendedVerifyWorkflow`; once the
candidate carrying it receives all Workflow traffic and the extension lane runs
the merged revision, enable the dispatch flag and unpause this exact schedule
(Tracker AI-485). Reconciliation preserves the operator's subsequent pause
state. `toolkit ci timings` reports these pipelines in the `extended` cohort,
and `toolkit ci main` ignores them because they lack the release graph.

Vacuum start verification reads Home Assistant recorder history after each start
request. Short cleaning transitions count as starts even when delayed state
polling sees the vacuum docked again. A witnessed start followed by logbook
`vacuum.return_to_base` context records `interrupted/commanded-return` in the
Workflow memo and outcome metric. The interruption alert is informational:
active, unsilenced and uninhibited alerts appear in the ops snapshot, while
Alertmanager routes them to the null receiver without paging or webhook-ledger
delivery. It never restarts the vacuum automatically or infers who sent the
command. Missing starts and unexplained stops remain failures.
Retained histories use the pre-history verification branch through a Temporal
patch marker.

Production uses one worker image across role-specific Kubernetes Deployments. The
`control` role owns schedule reconciliation and public HTTP/event surfaces
plus the `agent-chat-ingress` command queue and isolated
`agent-chat-delivery` queue. The credentialless
`workflows` role owns deterministic Workflow execution on
`monorepo-workflows`. The domain roles own only Activity
Workers, with separate registries, credentials, service accounts, and
concurrency budgets. The explicit `all` role composes every role in one process
for local development.

The repo worker reads first-party build provenance from private Docker Hub
images using its namespace's reader Secret. Its credential authenticates only
the Docker Hub token exchange for first-party repositories; upstream metadata
lookups remain anonymous.

The infra worker's daily DNS audit reads the validated
`packages/homelab/src/domain-registry.json` inventory in its `getDomains`
Activity. Domains with `fastmailReady` are audited as mail domains; the others
are audited as parked. The inventory ships in the worker image, and Activity
results keep Workflow replay independent of later inventory changes.

Temporal namespaces are environment-scoped: local servers use `dev`, Scout
beta uses `beta`, and production plus shared control-plane jobs use `prod`.
The shared cluster contains only the active `beta` and `prod` namespaces plus
Temporal's internal `temporal-system` namespace. Unexpected workflow starts in
any other namespace raise `TemporalUnexpectedNamespaceStartAttempted`.

The central Scout worker also polls the unchanged `scout` queue in `beta`
to drain retained executions. The central Workflow and reports workers also
poll `beta` for the explicit notification acceptance canary. Other central
Activity queues are `prod` only. Retired economy schedules are removed by
schedule reconciliation.

| Role              | Queue or surface                                                                       |               Activity concurrency |
| ----------------- | -------------------------------------------------------------------------------------- | ---------------------------------: |
| `control`         | schedules, HTTP APIs, `agent-chat-ingress`, `agent-chat-delivery`, `agent-chat-photon` |                        4 per queue |
| `home`            | `home`                                                                                 |                                  4 |
| `reports`         | `reports`                                                                              |                                  4 |
| `infra`           | `infra`, `mining-reset`; bounded Ops collection on `ops`                               | 1 on each legacy queue; 4 on `ops` |
| `repo`            | `repo-automation`, `agent-chat-dispatch`, `agent-chat-receipts`                        |                        1 per queue |
| `scout`           | `scout`                                                                                |                                  1 |
| `agent`           | `agent-task`                                                                           |                                  1 |
| `promotion`       | `storm-promotion`, `storm-promotion-control`                                           |                        1 per queue |
| `glitter-corpus`  | `glitter-corpus`                                                                       |                                  1 |
| `glitter-context` | `glitter-context`                                                                      |                                  1 |
| `maintenance`     | `maintenance`                                                                          |                                  1 |
| `media-network`   | `media-network`                                                                        |                                  4 |
| `media-files`     | `media-files`                                                                          |                                  1 |
| `workflows`       | `monorepo-workflows`                                                                   |                               none |
| `streambot`       | `streambot`                                                                            |                                  1 |

The `streambot-lol-playback` Schedule reconciles explicitly selected LoL series
through the isolated `streambot` Activity queue. The worker receives only its
internal Streambot endpoint and dedicated scheduler credential. Its tracing
bootstrap sends spans to the internal OTLP collector on port 4318; it has no
Flipt management access or media user credentials. Streambot owns
the durable schedules, Discord authorization, media resolution, and playback
effects. The Schedule starts paused until both consumers are deployed and healthy;
its next execution reconciles uncertain prior effects from persisted playback
ownership rather than blindly repeating them. See the Streambot package README
for browsing and cancellation commands.

The production manifests land in layers. The gateway, Workflow worker, and
domain Activity Workers deploy independently so each queue has its own
credentials, concurrency, health, and metrics boundary.

The [Media application](../media/README.md) defines two Activity roles in the
media Kubernetes namespace. Network Activities own authenticated provider,
qBittorrent, Plex, and notification calls. File Activities have read-only download
mounts and writable library mounts, without provider credentials. Deterministic
Media Workflows stay on `monorepo-workflows` in the `prod` Temporal namespace.
The application image publication gate controls whether the Media workloads are
synthesized. Media schedules are declared initially paused; their existence does
not establish that application workers or recovery procedures are ready.

`reconcileMovieEditionV4Workflow` dispatches a scoped acquisition child through
Network discovery/submission, Files inspection/publication and Network Plex
verification/finalization. `acquireMovieSubtitlesV4Workflow` uses Network lookup
and Files installation for downloaded or validated embedded captions. Their
Activities declare two-minute attempts, three-minute totals and a thirty-second
queue wait; Files have a thirty-second heartbeat timeout. Quota-bearing torrent adds and
caption lookups have one automatic attempt. Original SDK observations precede
lazy runtime loading and stay attached to the producer's proof window. These
versioned histories leave the ordinary Media contracts below unchanged.

The same movie coordinator also accepts work queued by an actual adopted-library
management policy. Network Activities resolve the immutable import approval and
current owner/monitoring/profile authority; Workflow history carries scoped IDs
and outcomes, without the grant, library paths or personal requester fabrication.
Only the newly created transfer becomes Media-owned. The existing reconciliation
sweep supplies this work without a separate Schedule or Workflow type.

Recent-provider feed matching uses the same management authority for monitored
adopted movies and individual TV episodes. Its Network adapter captures the SDK
deadline and one provenance allowance before loading the runtime, then retains
them through candidate selection and the acquisition command's transaction.

Personal named-edition targets also receive recurring due commands through that
sweep after a completed search found no acceptable release. Discovery keeps the
same edition, live choice and generation, deduplicates its due command and
rechecks cancellation before any reservation. Search-only providers use this
path without pretending to supply a recent-listing feed.

`rollbackMovieEditionV1Workflow` carries an owner-reviewed rollback through fresh
Network playback admission, Files preparation, another playback check, the
journaled inverse and exact Plex verification. Network and Files use separate
production adapters and retain their original SDK owner and one provenance
allowance. The original successful acquisition and its serving receipt remain
historical; rollback cancels the original archive cleanup without extending its
window and retains the rejected successor's owned captions separately.

`applyLibraryHandoffV3Workflow` runs the separately
approved initial-library label corrections: `media-files` proves each reviewed
movie before `media-network` records its send intent and edits the existing Plex
edition field. Workflow history contains IDs and opaque proof references only.
File hashing retains its twelve-hour SDK budget while each metadata effect
retains the original sixty-second bound. Failed or cancelled application fences
ownership for review; retries of uncertain edits observe the original intent.
Earlier read-only handoff Workflow types remain unchanged.

Media Activity declarations provide finite schedule-to-close deadlines as well
as start-to-close deadlines. Ordinary acquisition, notification, recovery and
cleanup Activities explicitly retain their historical 315,360,000,000 ms total
window, because servers normalize omitted totals differently. Per-attempt
timeouts and retry limits are unchanged. Dedicated observation, Archive and
Compensation queues retain their explicitly declared total windows.
Execution adapters reject missing or zero SDK deadlines and retain the original
minimum through configuration, network, and filesystem work. Changing a Workflow
declaration does not rewrite an Activity already recorded in history; an older
unbounded Activity remains protected and needs reconciliation through fresh work.

`reverifyPlexBindingWorkflow` runs cold verification on `media-network` through
the existing inventory outbox. Its arguments contain operation/epoch/asset IDs;
complete expected coverage and immutable evidence remain in Media PostgreSQL.
Its bounded result contains a count or a protected/superseded outcome, never
Plex metadata, paths or household identities. Invocation-local wall/monotonic
clocks and cancellation are captured before lazy runtime initialization. The
sixty-second verification window is separate from the SDK deadline: an exact
committed receipt may still be acknowledged after proof expiry while the SDK
invocation remains active. No additional schedule or file-worker credential is
required.

Initial library receipts queue `verifyLibraryPlexBindingWorkflow` separately
from the retained handoff histories. This Network-only Workflow receives
operation, receipt, asset and epoch IDs and uses the same bounded result and
invocation adapter. Media resolves the original approved file and source report,
verifies the exact movie cut or complete TV hierarchy in two stable passes, and
commits the serving bindings and immutable receipt together. It creates no
request or acquisition attempt. Files and label correction complete through
the original handoff before this read-only Plex check is queued.

Plex event hints use the existing durable outbox to start
`observePlexEventHintWorkflow` on `monorepo-workflows`; its only observation
Activity runs on `media-network`. History contains bounded media/mapping IDs,
never the webhook capability, raw payload, account or poster. The default-off
hint gate does not replace polling or final retention checks. A hint requests a
fresh scoped watch read; it grants no deletion authority.

Named movie item claims instead dispatch `observeMoviePlexHintV4Workflow` with
the exact canonical movie/edition and recorded generation/epoch. Its Network
Activity carries the original SDK clock across lazy runtime loading and uses
the same default-off hint gate and requester-scoped observer. The regular watch
sweep also visits named targets in bounded pages after default movies and TV;
its existing Workflow loop and Activity budgets are unchanged. Historical
default hints retain their original Workflow and payload identity.

Each watch observation obtains the current Activity cancellation signal and a
wall/monotonic deadline before IO. The current attempt's scheduled timestamp
plus its explicit start-to-close timeout bounds work conservatively, including
queue delay. The SDK's required overall timeout further caps it. Both SDK
timestamps and budgets must be finite and positive, including when the server
supplies the overall budget for an omitted Workflow option. Existing
Workflow options remain unchanged. The new hint Activity declares both budgets,
heartbeats and bounded retries, and sanitizes failures before history encoding.
Capability provisioning, proxy URL-log privacy and actual PMS delivery remain
separate prerequisites before enabling hints.

Native archive prepare/apply Workflows observe current Plex playback and archive
exclusion on `media-network`, then prove or rebind exact files on `media-files`.
Their separate expiry cleanup Workflow preserves the original deadline and
refreshes network evidence during physical work. The existing inventory sweep
pages ordinary current-epoch cleanups before a separate archive-continuation
cursor; historical pending rows cannot replay old cleanup authority. No new
schedule is added. Only explicitly selected archives receive cleanup commands;
retained dependencies and current playback remain retained. Every new archive
Activity obtains invocation-local cancellation and finite wall/monotonic SDK
deadlines before runtime initialization, with checks around awaited work and
physical effects. Current-version transitions lacking an immutable physical
receipt remain protected rather than renewing authority through another review.

Interrupted upgrades use separate `prepareNativeCompensationWorkflow` and
`applyNativeCompensationWorkflow` reviews, followed by
`compensateNativePublicationWorkflow`. Network Activities refresh exact Plex,
playback and storage observations; file Activities restore only the reviewed
predecessor and retain successor bytes. Durable execution and coordinator fences
allow an exact cold retry without resuming the old acquisition. Completion keeps
files importing and household holds active. After fresh positive household
authority covers every leaf, `publishCompensatedMediaWorkflow` verifies Plex and
atomically releases the publication fence with availability. Mixed or missing
choices remain protected. These operations use the existing outbox and role
queues, with no additional schedule. Each invocation checks cancellation and
finite SDK deadlines before and after runtime initialization, awaited locks and
effects. Ordinary publication uses the same invocation-local deadline factory
at its recorded filesystem boundary; existing Workflow timeout options and
historical payload formats remain unchanged.

Series packs with per-episode files use distinct
`prepareSeriesPackNativeCompensationV1Workflow` and
`applySeriesPackNativeCompensationV1Workflow` reviews. Their actual outbox commands
dispatch `compensateSeriesPackNativePublicationV1Workflow` for the whole physical
group and `publishSeriesPackNativeCompensationV1Workflow` for later household
publication. Original staging and publication receipts stay unchanged. One Files
invocation handles the complete reviewed video/caption inventory under its
original authority allowance; physical completion alone does not release the
publication fence. A changed playback observation cancels and drains the
physical Activity before recording a protected terminal outcome. Earlier
compensation Workflow types and recorded histories retain their original path.

The initially paused `media-capacity` schedule runs each minute with SKIP overlap.
Its new Workflow first observes canonical mounts on `media-network`, then samples
them on `media-files`; the API never mounts libraries. Each Activity checks the
typed `capacityObservationEnabled` flag once before allocating its durable
ordering token or performing IO. Collection works in observe mode and creates
no ownership, writer, storage or deletion authority. Existing file operations
retain their independent capacity checks. Role-bound cycle and sample-attempt
counters reject late results, including retries of the same token. Missing,
expired or changed mount proof prevents sampling.

Capacity Activities use finite queue and execution budgets. Each invocation
derives a conservative wall and monotonic deadline from Temporal's scheduled
timestamps and explicit timeouts before lazy runtime initialization. The current
attempt's scheduled timestamp includes queue delay, deliberately shortening the
allowed work; it is not treated as an actual start timestamp. Cancellation and
deadline checks surround IO and transactional writes, so a late unabortable
filesystem call cannot publish a fresh reading. No existing Workflow history is
changed by this separate schedule and Workflow.

The infra process polls `ops` separately so every-five-minute snapshot fan-out
can overlap four bounded reads while heavyweight infra automation stays serial.
Ops queue routing is recorded with the `ops-isolated-activity-queue` Workflow
patch. Histories created before that patch retain their `infra` Activity queue;
the infra registry keeps the old Ops Activities available to drain them. The
same worker credentials, pod limits, and metrics endpoint serve both queues.

The work collector reads Tracker through the credentialless `TRACKER_URL`
bootstrap endpoint and builds issue links from `TRACKER_PUBLIC_URL`, which the
browser can reach. New Workflow histories use the `ops-tracker-source` patch
and `collectOpsTracker`; the registered `collectOpsLinear` alias also reads
Tracker while old histories drain. Publication normalizes recorded legacy
source values before building a snapshot. The collector emits
`tracker_issues_open`, with `SJ` triage retaining its needs-owner meaning.

The tracker attachment cleanup uses the serial infra queue hourly, deleting at
most 100 staged files older than 24 hours.
Its `tracker-staged-attachment-cleanup` schedule registers paused until tracker
is active and compatible Workflow workers receive all traffic. A tracker write
freeze returns a paused result; committed attachments are never candidates.
Unpause only after the service and worker acceptance checks.

Woodpecker log retention uses the serial infra queue on a daily 04:45 Pacific
Schedule with SKIP overlap, initially paused. The typed minimum retention is 30
days and destructive execution defaults off. Exact candidates, protections,
continuation cursors and deletion receipts remain in Workflow results; logs alone
are deleted. See the [operator procedure](../docs/wiki/src/content/docs/how-to/retain-woodpecker-logs.md)
for candidate rollout, dry-run review and activation.

The agent worker keeps the Temporal poller at UID 0 and launches provider
subprocesses at UID 1001. The owner firewall blocks provider access to Temporal.
The worker retains only `SETUID`, `SETGID`, `CHOWN`, `DAC_OVERRIDE`, and
`KILL`: it must set the provider identity, transfer fresh checkouts, read and
clean up private provider-owned session files, and terminate detached
provider-UID processes before that shared identity is reused.
Provider subprocesses lose these capabilities when their UID changes, and
`allowPrivilegeEscalation: false` prevents regaining them.

The image starts the worker under Tini to reap orphaned provider and tool
processes. The UID cleanup checks require those processes to disappear before
another turn starts; unreaped zombies otherwise block the queue. Claude's
required Linux sandbox dependencies, Bubblewrap and socat, ship in the image
and are checked by the image smoke gate.
Claude also requires a node and container policy that permit its sandbox's
user namespaces. Installed binaries alone do not prove that the sandbox can
start; verify a provider turn under the production subprocess identity.

The shared agent runner keeps authentication separate from tool environments.
API-key automation uses the Codex SDK. Subscription chats use Claude Agent
SDK or Codex App Server with in-memory `chatgptAuthTokens` authentication and
ephemeral credential storage. Subscription Codex requires an isolated
`CODEX_HOME` without `auth.json`; dropped-UID Claude requires an explicit isolated
`HOME`. Both providers receive writable session directories, restored to the
worker after execution. Codex credential renewal is a terminal authentication
failure requiring an updated credential source, not a session-file write.

## Quick start

Run from `packages/temporal`:

```bash
TEMPORAL_NAMESPACE=dev TEMPORAL_WORKER_ROLE=all bun run start # start the local worker
bun run typecheck    # tsc --noEmit (stubs the HA schema first)
bun run test         # unit tests, including the workflow-bundle smoke test
bun run lint         # eslint
toolkit deploy workers list temporal/prod --json
toolkit deploy status DEPLOYMENT_ID --json
```

Delivery owns worker release selection, replay, exact-version canaries,
progressive routing and retained-host retirement under a PostgreSQL environment
lock. Use `temporal/prod`, `scout-for-lol/beta`, or `scout-for-lol/prod` explicitly.
A rollback selects a previously accepted version set and preserves hosts still
serving current, ramping, canary or pinned executions. Git holds no promoted
worker pin, rejected-candidate queue or routing lease. Independent worker
recovery proves exact source, host, routing and execution state before releasing
ownership; it never rewrites a failed release as accepted. The control-plane
worker has its own frozen upgrade intent and original image provenance.
If an earlier attempt already made the exact candidate current, a normal retry
repeats the full preflight and final normally routed canary. Promotion reads back
that unchanged current route without repeating the routing write; active ramps
and missing or changed current routes still block continuation.

Retirement excludes known `AutoUpgrade` executions from historical host
references; their next Workflow Task follows normal deployment routing. Pinned
and one-time overrides remain pinned references, and missing or unknown
versioning behavior remains blocking. Retirement still requires the accepted
pool, routing exclusion and fresh native drainage or inactive-incarnation proof
in every served namespace; historical usage alone never supplies drainage.

Worker Jobs execute controller logic from the qualified executor's source.
Replay and canaries run in a separate clean checkout at the candidate image's
original source revision, with its frozen dependencies and build prerequisites.
Upgrading the controller does not reinterpret a reused candidate image as a new
build or replay the controller's Workflow code as the candidate.
For a rollback, the executor reads the exact restored deployment from Delivery
and freezes its successful acceptance, selection and retained worker artifact
into each routing Job. That proof must match the request's environment, service,
version set, recipe, configuration, image and build. It supplies the prior
production acceptance even after beta advances. New promotions still require
the candidate to be current in beta. Both paths retain image provenance, live
pollers, candidate replay, pinned canaries, stable-route checks and final
normally routed verification.
The candidate's locked Node toolchain also runs its Workflow unit tests. Replay
selects one exact retained execution per exported Workflow type in the target
namespace and worker queues, preferring the latest open run and otherwise the
latest closed run. Types without retained history are reported; an entirely
empty selection fails. Each selected Workflow and run ID is passed explicitly
to the candidate, without provider credentials or history payload logging.

After a guarded native sync succeeds, transport timeouts recording its completion
are handled by bounded, identical journal POSTs with fresh claim, operation and
frozen-selection checks. A committed acknowledgement is read back rather than
reposted. The native selection and sync are never repeated by this path; other
failures still retain quarantine.

The hourly `llm-billed-cost-hourly` schedule starts
`runLlmBilledCostReconciliation` on `monorepo-workflows`. Pause it before
repairing or replacing the Workflow bundle, then resume it only after a pinned
canary and one bounded scheduled run complete. The Workflow delegates the OpenAI
Costs/Usage and Anthropic Cost Report calls to the isolated `billing` Activity
queue, whose worker alone holds `OPENAI_ADMIN_KEY` and
`ANTHROPIC_ADMIN_API_KEY`. Live acceptance requires populated
`llm_billed_cost_usd` for both providers and a fresh
`llm_billed_reconciliation_last_success_timestamp_seconds`. The Prometheus rules
use `container="temporal-billing-worker"` for worker freshness, which is stable
across pod recreations. The retired `openai-complimentary-usage-hourly` schedule
is deleted at registration.
Scout pollers are materialized from the frozen PostgreSQL worker pool. Native
baseline adoption retains exact observed host identities without qualifying an
old failed build as a new candidate. A new release selects a genuinely qualified
image and preserves every host still required by routing or open histories;
Git supplies no stable, candidate, or historical deployment image slot.

## Photon iMessage ingress

The control gateway mounts signed `POST /webhooks/photon` on the existing agent
task API server. Bootstrap requires `SPECTRUM_PROJECT_ID`,
`SPECTRUM_PROJECT_SECRET`, and `SPECTRUM_WEBHOOK_SECRET`. Missing all three
leaves the route unavailable; a partial set fails startup. Behavior uses the
typed `temporal-agent-chat-photon-enabled` and `temporal-agent-chat-photon-owners`
flags. Both default to closed admission: disabled and no permitted senders.

Native Spectrum HMAC verification covers the original body bytes and permits
five minutes of timestamp skew. The route awaits a completed Temporal Update
before acknowledging receipt. It accepts only allowlisted inbound text direct
messages. Conversation and command identities hash the project, space, and
message IDs; webhook registration changes do not alter deduplication.

Each conversation serializes commands behind its current selection and retains
up to 50 pending commands, 100 recent fingerprints, and 500,000 bytes of state.
Continue-As-New carries ordering and admission state after 100 settled commands.
Late timestamps receive a resend response without running inference. Commands
use the same syntax below; initial ordinary text requires an explicit `/new`.
New chats snapshot the existing iMessage provider/model flags.

Preparation and one-attempt reply delivery use `agent-chat-photon`; long
provider and duplicate-command waits use `agent-chat-ingress`. A failed or
ambiguous send leaves the checkpointed response in the command execution and
never automatically repeats inference or delivery. The SDK uses server-marked
retryable RPCs with its transport idempotency; the Workflow makes one send call.
Durability begins after gateway receipt. Photon can exhaust its finite webhook
retry window during an ingress outage, requiring the sender to resend.

Inspect `photonConversationState` for pending commands and ordering. Gateway
metrics `photon_webhook_total` and `photon_delivery_total` expose bounded outcome
labels without message bodies. Disabling admission lets accepted work settle.
BlueBubbles has no bootstrap, credentials, Activity poller, or admission flags.
Its Workflow definitions remain only for replay of closed histories.

The pinned Spectrum 12.10.1 packages have declaration-only Bun patches. Core's
optional generic fields admit `undefined` with `exactOptionalPropertyTypes`;
iMessage derives its definition from its config return type instead of an
incompatible overloaded conditional type. Runtime SDK code is unchanged.

## iMessage commands

| Input                          | Operation                                                 |
| ------------------------------ | --------------------------------------------------------- |
| `/new claude <prompt>`         | Create and select a Claude Code chat                      |
| `/new codex <prompt>`          | Create and select a Codex chat                            |
| `/chats`                       | List recent chats from every transport and schedules      |
| `/use <chat-id>`               | Select any existing chat, including catalog-evicted chats |
| `/continue <chat-id> <prompt>` | Continue and select an explicit previous chat             |
| Ordinary text                  | Continue the selected chat                                |
| `/help`                        | Show command syntax and prompt limits                     |

Prompts are limited to 4,000 characters. New chats snapshot
`temporal-agent-chat-imessage-claude-model` or
`temporal-agent-chat-imessage-codex-model` according to their provider.

## Report mail configuration

The weekly dependency report resolves first-party deployment aliases to their
actual GHCR image repository and reads each immutable pinned digest. Internal
promotion evidence compares the application's baked `GIT_SHA` against GitHub
source commits, separately from upstream release notes. Images can inherit a
base-image revision label, so that label alone is insufficient first-party
build evidence. Missing build identity or upstream notes remains an explicit
evidence gap; promotion PR prose is not counted as build-change evidence.

The homelab audit preserves informational and suppressed alerts, merges matching
Prometheus and ledger conditions with both evidence references, and distinguishes
recovered failures from failures without proven recovery. A long-running Workflow
needs a stale pending task or repeated Workflow-task failures to become a stall;
quiet waits and recent Activity heartbeats remain informational.

Ops schedule-health collection scans completed scheduled executions once per
namespace over the previous 24 hours, groups them by schedule, and deduplicates
execution descriptions within that namespace. Production and beta share eight
concurrent read slots and a 45-second deadline inside the collector's 60-second
Activity budget. Visibility requests fetch up to 1,000 executions per page to
reduce repeated RPCs across that window. Direct audit callers use the same
bounded SDK scope.
Cancellation reaches the Temporal RPCs and queued reads. An incomplete
collection fails the source and preserves the last complete metric
observation; it cannot publish a fresh healthy inventory.

Ops digest Activity results retain the dashboard's `periodKey`, `status`
(`sent` or `skipped`), and `duplicate` outcome in Workflow history and results.
`sent` means the dashboard's mailer accepted the message; it does not establish
inbox delivery. Histories recorded by older workers contain only `kind` and
remain replay-compatible; no additional Workflow command is introduced.

The reports worker resolves `temporal-email-recipient` and
`temporal-email-sender` through typed configuration for each delivery activity.
Defaults preserve the existing homelab routing during a flag-provider outage.
Postal credentials stay in 1Password; service endpoints and host routing are
reviewed homelab bootstrap settings. Workflow histories contain no credentials.

`temporal-daily-report-notifications-enabled` resolves per Activity and defaults
on in production; beta retains its declared targeting. When enabled,
the homelab audit and Scout queue-window daily schedules, plus the explicit
beta notification canary, use changed-condition mail.
Each run keeps its full immutable report under
`reports/observations/<namespace>/<type>/<schedule>/`; a baseline, changed
actionable condition, or recovery sends mail. An unchanged actionable condition
sends a reminder after seven days, while unchanged clear reports stay silent.
Known finding identities ignore changing observation counts; unknown findings
retain their text so a new failure cannot be hidden. Suppressed, recovered, and
observing findings remain in the archive without creating active conditions.

Conditional family claims serialize sends and skip decisions across runs.
A takeover settles the prior pending decision before evaluating the next report;
pending sends use their existing delivery lease and accepted receipt. The latest
completed observation also advances on a skip, so a delayed older condition
cannot replace a newer quiet recovery. Report delivery proxies use the shared
lease-aware retry policy so an immediate failure cannot exhaust retries
inside the claim's takeover window. An exhausted delivery fails the Workflow
without creating a synthetic collection-failure report; actual collector
failures retain their failure report. A patch marker preserves older recorded
failure paths during replay. Skips have explicit records and no Postal
message ID or acceptance time. The freshness monitor counts completed skips
separately from mail acceptance, using the report's original observation time.
Each family has a conditional latest-heartbeat index beside its immutable
receipt or skip prefix. Delivery retries repair a missing index without sending
again, and older acceptances cannot replace newer ones. The monitor validates
the indexed original record rather than trusting S3 modification time. Existing
history migrates in pages of at most 25 records per family per scan; until it
finishes, an otherwise missing or stale result is `indexing`, while a validated
recent record can already establish freshness. After migration, each scan reads
only the index and its original record for each family.
Manual reports, dependency checkpoints, digests, other canaries, and other schedules
retain their existing delivery behavior. Postal acceptance still does not
establish inbox delivery.

`daily-notification-policy-canary` is declared only in `beta` and starts paused.
After promoting a central Workflow candidate containing `runDailyNotificationCanary`
and deploying the reports worker with beta polling, trigger the paused schedule
twice with its declared `attention` input: the first run must have a real Postal
receipt and the second an explicit unchanged skip. Start the same Workflow in
`beta` with `condition: "clear"` to verify recovery mail. Inspect the immutable
reports, family state, skip record, and actual acceptance receipts; a completed
Workflow alone does not prove delivery. Keep recurring delivery paused during
this rehearsal. The Workflow rejects every namespace other than `beta`.

## Scout queue-window warnings

`refreshScoutQueueWindows` computes queue-window drift deterministically from
the `scout-prod` match lake. A `sparse-no-close` warning means an open-ended
window had no tracked matches in the lookback, which cannot distinguish an
ended mode from one tracked players skip. For each such warning the Scout
worker runs a two-call liveness check with `gpt-5.6-sol` through its
`OPENAI_API_KEY`: a web-search research call
(`scout.queue-window-liveness.research`) and a tool-less structured verdict
(`scout.queue-window-liveness.finalize`) of `live`, `ended`, or `unknown`.

The model only proposes. `live` is accepted only when a cited URL is a Riot or
League wiki page that the research call's own web search returned. An accepted
`live` warning becomes an `observing`/`info` finding and leaves the warning
fingerprint and consecutive-run streak, so a report whose sparse warnings are
all verified live is `clear`. `ended` and `unknown` stay active warnings;
`ended` adds an action to set the window's `end` in `queue-windows.json`. A
provider, transport, timeout, or structured-output failure records `unknown`
with its error class and fails the optional "Liveness verification (web
search)" check without failing the Activity. Results recorded before the check
existed carry no `livenessChecks` and render their original report.

## The Storm promotion task

The caller selects a target, action, approved content and timing before invoking
the promotion executor. The LLM discovers the current interface, performs that
assignment once, and records the site's actual response. Posting-policy and
cross-community cadence decisions belong to the caller. There are no
per-site login scripts, generated CSS selectors, posting-rule regex parsers, or
required preflight/publish/verify tool sequences.

Each run receives `task.json` with its target and mode, `content.md` with approved
copy, `history.json` with the latest 50 attempts' metadata, and
`previous-run.json` with the preceding assessment and prepared content.
`maintenance.md` context includes the human inventory and recorded manual actions,
excluding the account locator section. Manual receipts retain their stated date
precision and serve as optional reference for locating existing placements.
The [target manifest](../the-storm/promotion/targets.json) and approved copy are bundled
into the worker image. Original page baselines remain in private object storage.
The complete ledger remains available to the runner.

`BROWSER.md` documents native PinchTab navigation, scoped scanned snapshots,
element references, attributes, screenshots, and actions. The agent chooses its
own controls and sequence; native input references work inside web components.
The small connection helper scopes operations to the target's persistent profile.
Credential placeholders let the agent choose username, optional saved email, and password inputs while the
parent supplies their values privately. A disabled sign-in control can be
inspected and corrected; an actual or ambiguous sign-in submission is not retried.
Google's separate identifier and password stages each permit one observed Next
submission after the corresponding private credential is filled. This permission
is restricted to `accounts.google.com`; ordinary form continuations stay blocked.
The additional `captcha.ts` helper solves supported response-field reCAPTCHA v2
and Turnstile widgets without submitting the page.
When a detected widget still lacks a response, login submission returns
`captcha_required` before dispatch and preserves the one allowed login attempt.
The agent solves the challenge, inspects the form, and submits the login once.
Before creating a paid task, it checks whether the current response fields are
already populated. `alreadyStaged:true` reports that state without exposing a
response value or buying another solve. A challenge iframe can remain present
after the native widget completes; its presence alone is not a blocker.
Paid results are cached privately for the current widget and browser document.
Repeated calls return the same task and `reused:true` without another charge.
If applying a solved response times out, the next call retries application of
that cached result. An ambiguous provider failure is retained instead of
silently buying another task. A new document or changed widget gets a distinct
cache entry and remains subject to the occurrence and monthly budgets.
The agent must report an unresolved required CAPTCHA as blocked.
`bun browser.ts solve-cloudflare` invokes PinchTab's named native solver after a
scanned snapshot of a Cloudflare interstitial. It rejects ordinary login and
publication forms, allows one attempt per page and two pages per run, and checks
that the challenge title has cleared. A paused handoff is a blocker, not a retry.
The agent must inspect the resulting page to establish actual access.

`runStormPromotion({ targetId, mode })` accepts `run`, `preview`, or `reconcile`.
The stable Workflow ID is `storm-promotion/<targetId>`.

The production dispatcher uses Pacific sweeps at 08:00, 12:00, 16:00 and 20:00.
Daily and less frequent sources are assigned in the 16:00–20:00 window;
a durable Workflow timer waits for a source's recorded cooldown within that
window. Fast sources allow at most four attempted publications per Pacific day.
These limits never shorten a native or subreddit-specific cooldown.
The `promotion-core-hours-v1` patch preserves earlier dispatcher histories.

The promotion worker exposes authenticated, read-only status on port 7343.
The Ops server proxies `/api/v1/promotion`, `/history`, and hash-addressed
`/evidence/<id>` requests to the `promotion-status` Service using its existing
parent-only `OPS_INGEST_TOKEN`. The normal Ops client renders `/promotion`.
Status reads do not initialize target state or release duplicate-prevention holds.
Each scheduled sweep journals all selected and skipped sources; targeted
previews and reconciliations retain their own scope and effective mode.

`the-storm-promotion-enabled` defaults off and settings default to an empty
source allowlist. `dailySpendUsd` defaults to 5 and cannot exceed 5. Recorded
AI charges and CAPTCHA reservations stop admission of additional paid tasks;
unknown provider usage also stops admission. This is an operational spending
stop, not a provider billing ceiling. Setup failures before generation record
zero usage. The worker bootstraps the isolated outreach Discord daemon from
its assigned login, verifies its identity, and withholds vault and inference
credentials from that child process.

The one-time history handoff utility reads local SQLite in read-only mode:

```bash
bun packages/temporal/scripts/promotion/production-handoff.ts
```

`--state-dir` selects a different local ledger. Applying additionally requires
`--apply`, `TEMPORAL_NAMESPACE=prod`, publishing disabled, and the existing
authenticated object-storage/flag environment. The `--apply` CLI initializes
and closes the flag provider using the existing `FEATURE_FLAGS_MODE`,
`FLIPT_URL`, `FLIPT_NAMESPACE` and `FLIPT_ENVIRONMENT` bootstrap; dry runs do not
connect to it. The importer refuses active
local owners and conflicting production state. It preserves pauses, cooldowns,
and unresolved effects, uploads content-addressed evidence, then records a
completion digest. An interrupted identical import can resume; an existing
different completion digest cannot be replaced. Stop local publishing before
handoff and keep it stopped while production owns the ledger.

For a local dry run, start the local PinchTab daemon and run from the repository
root with the enrolled 1Password service account:

```bash
scripts/onepassword/with-service-account.sh op run \
  --env-file packages/temporal/scripts/promotion/preview-local.env.references \
  -- env -u OP_SERVICE_ACCOUNT_TOKEN bun packages/temporal/scripts/promotion/preview-local.ts \
  pmc minecraft-serverlist reddit-mcservers
```

For persistent local development, use `scripts/promotion/local.ts` instead of
the disposable preview command above. It invokes the same executor and tools
without connecting to a Temporal server or starting a schedule. `run` means a
real external action even though execution is local; invoke it only for the
targets the operator requested.

```bash
bun packages/temporal/scripts/promotion/local.ts import-history \
  --history packages/the-storm/promotion/manual-history.json
bun packages/temporal/scripts/promotion/local.ts status --all
scripts/onepassword/with-service-account.sh op run \
  --env-file packages/temporal/scripts/promotion/preview-local.env.references \
  -- env -u OP_SERVICE_ACCOUNT_TOKEN bun packages/temporal/scripts/promotion/local.ts \
  preview pmc
```

Replace `preview pmc` with `run pmc` only when a real bump is requested. Multiple
explicit IDs or `--all` select a sequential batch. The canonical `targets.json`
includes Discord, Reddit, forums, directories and onboarding blockers; passing
the old supplemental inventory is unnecessary. `pause`, `resume`, and
`reconcile` accept exact IDs. Resume clears the automatic failure streak but retains posting
history. Reconciliation never sends a new promotion; a live prior process
cannot be displaced. Discord reconciliation currently searches the latest
30 channel messages and reports a blocker when the receipt is outside that window.

A transient executor failure leaves the source retryable on the next selected
run. Two consecutive failed executions automatically pause publishing; a verified
success resets the streak. Previews, cooldown skips and unsuccessful read-only
reconciliation do not increase it. Repeated delivery of the same outcome counts
once. An uncertain publication still blocks another publication immediately
until its remote outcome is established. Explicit pauses are independent of the
failure streak; existing saved pauses are retained. `resume` clears the streak
after repair without discarding receipts, cooldowns or uncertain attempts.

After a verified DISBOARD bump, the parent saves the receipt evidence and effect
history, then deletes only that bot confirmation through toolkit's exact-message
cleanup endpoint. It verifies the guild, channel, message ID and bot author before
deleting, and confirms remote absence afterward. An already deleted reply needs
no further write. Permission or transport failures are recorded as cleanup
blockers; they never trigger another bump or erase its cooldown. Ordinary ads
are retained. Preview never deletes messages.

View local progress without credentials or a Temporal server:

```bash
bun packages/temporal/scripts/promotion/dashboard.ts
```

The local Ops page at `http://127.0.0.1:7342/promotion` reads the same SQLite
state and retained reports. The default view summarizes the latest full run,
with working, disabled and attention groups; follow-up retries and corrections
remain in history without replacing that run. Confirmed recoveries count as
success; only unresolved failures keep the run in the attention state.
New executions record full/selected scope, queued sources, phases,
heartbeats, typed controller skips, and terminal outcomes. Confirmed effects
remain authoritative in the existing attempt journal; a dashboard or reporting
failure never authorizes repeating a publication. Preview, real publishing,
reconciliation and reply cleanup are displayed separately. Older reports retain
unknown metadata where no mode or exact execution timestamp was saved.
The dashboard is read-only and independent of the runner. See the Ops README
for ports, storage options and access from another machine.

State defaults to `~/.local/state/the-storm/promotion`; `--state-dir` selects a
different directory. SQLite conditional writes retain attempts, ownership,
pauses, and both budgets between invocations. One executor may run at a time;
status and pause remain available. Import is idempotent and filtered receipts
pause only their target. Before the first real action on a target, import its
manual history. The checked-in seed comes from recorded receipts through
November 3, 2026; import any newer manual activity before a run.

`--settings FILE` accepts typed JSON with `model`, `maxSteps`, `timeoutMinutes`,
`dailySpendUsd`, and `monthlySolverUsd`. Defaults are the configured Luna model,
80 tool steps, 15 minutes, a $5 daily recorded-spend stop for AI plus CAPTCHA
in America/Los_Angeles, and the existing $10 monthly CAPTCHA ceiling. The runner
checks recorded spend before each task and records reported token usage afterward.
Missing usage stays unknown without a hypothetical charge. This is an operational
spend check, not a provider billing guarantee. The older disposable
preview command below does not share this ledger; use the persistent command
for development runs. `--mailmate` enables only the gated BuiltByBit code tool.

Each batch writes private `runs/<batch-id>/summary.json` artifacts and browser
receipt PNGs. Discord receipts currently retain structured native readback JSON;
rendered Discord screenshots remain part of operator acceptance. No cluster
deployment, email delivery, or unattended schedule is activated by these commands.

The disposable preview above uses the local browser configuration, real LLM and stored logins, with
in-memory task state and no Temporal server or production ledger. It prints
private temporary paths for the structured results and browser diagnostics.
The agent inspects the assigned execution path rather than conducting an
eligibility review. The references file
contains only 1Password locators; credentials are injected in memory.
Add `--mailmate` to a local BuiltByBit preview to enable private email-code fill.
It requires `python3`, `rg`, and the locally synced MailMate message directory.
The parent accepts only a provider confirmation email addressed to the stored
account and dated after the current run began. Codes stay in parent memory,
expire with the verification context, and permit one observed confirmation.
The fill tool accepts only the BuiltByBit account on its `/login/two-step` page.
The Codex task uses a native permission profile that denies direct reads of
the MailMate directory, including through symlinks; the parent code reader
retains access. Its Unix socket remains reachable from the task workspace.
This does not restrict ordinary network access. No mailbox access is enabled
for deployed workers. Check the parser with
`python3 packages/temporal/scripts/promotion/mailmate-code.test.py` and the
native macOS boundary with
`bun packages/temporal/scripts/promotion/verify-code-gate.ts` (synthetic mail only).
Use `--all` instead of target IDs to inspect every assigned target; pending
placements have no execution task and are excluded. `inspect` assignments are
preview-only and can check existing account access without inventing news. An optional
`--inventory /path/to/targets.json` adds schema-validated placements for local
inspection without changing production targets or schedules. Duplicate IDs fail.
`--profile <existing-profile>` can inspect an existing signed-in browser profile
in preview only; it does not prove that the deployed per-account profile is ready.
The transport clicks native navigation links after validating their destination;
this preserves account menus and client-side routing. Effect URLs and effect
links remain guarded. On a headed profile, cleanup keeps its last tab on the
assigned landing page so closing the last window cannot strand the instance.
Other tabs are preserved; headless task tabs are closed normally. Cleanup checks
that a closed task tab has disappeared before returning.

Credential enrollment also uses the service account exclusively. Run
`scripts/promotion/enroll-logins.ts --bindings <bindings.json> --apply` through
the repository's service-account wrapper. Each non-secret binding contains
`account`, an `op://<vault-id>/<item-id>` reference, `backend: "service-account"`,
`hosts`, and optionally `expectedUsername`. Custom credential fields use an
explicit `fields` mapping with `username`, `password` and optional `email`/`otp` labels.
An enrolled OTP field contains its `otpauth://totp` URI; the parent generates and
privately injects one code into an observed verification input, then permits one
verification submission. Seeds, codes and solver tokens stay outside agent output.
The script validates all sources,
updates the encrypted login map through an inherited pipe, and checks readback.
It never falls back to desktop 1Password. Inaccessible items remain blocked.

Local Discord previews use an isolated toolkit userbot daemon, selected by
`PROMOTION_DISCORD_SOCKET`. Each supplemental target pins `discord.guildId`,
`discord.channelId` and `discord.username` matching its URL. The bridge checks
the actual user identity, guild/channel and permissions before exposing reads.
The model receives `discord.ts` and `DISCORD.md`; its message or slash-command
tool records one proposed payload without calling Discord's publication APIs.
Slash assignments additionally pin `discord.slash` with `botId`, `command`
and `args`. The bridge reads the guild's native application-command index and
checks application-command permission before preparing the exact assigned
payload. Missing commands or permissions fail rather than producing a preview.
It also checks native default permission bits and application/command overrides.
Commands without required bits or overrides can be prepared by an ordinary
member. Configured custom overrides currently fail closed for explicit resolution.
This verifies Discord's reported requirements, not the bot's response to an
interaction; no interaction is sent during preview.
Mixed bot/user daemons and account/destination mismatches fail. Discord live
execution is disabled; production Discord placements remain manually maintained.
Use `--inventory packages/the-storm/promotion/preview-targets.json` with explicit
Discord target IDs for a Discord-only local preview. `--all` also includes the
default browser targets.
Start that daemon with `scripts/promotion/start-discord.ts` through the same
service-account `op run` injection and `env -u OP_SERVICE_ACCOUNT_TOKEN` boundary.
It uses the login-map account `discord`, verifies `the.storm.mc` in the isolated
session, and refuses unrelated identities. Missing credentials fail without
desktop lookup. The script prints the socket path for `PROMOTION_DISCORD_SOCKET`.
For an enrolled authenticator, the parent derives a current TOTP from the login
map and injects only that code into the bootstrap. The daemon exchanges it once
when Discord requests MFA, then removes the injected credentials. Enrollment
and recovery codes remain in 1Password.

| Operator command                           | Result                                                            |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `toolkit promotion status [target] --json` | Saved history, ownership, pause state and schedule deadline       |
| `toolkit promotion preview <target>`       | Prepare without publishing; permit budgeted access CAPTCHA solves |
| `toolkit promotion run <target>`           | Execute the caller's selected action once and record the outcome  |
| `toolkit promotion pause [target]`         | Block further promotion mutations                                 |
| `toolkit promotion resume [target]`        | Resume inspection; uncertain effects still require reconciliation |
| `toolkit promotion reconcile <target>`     | Inspect a prior uncertain effect without creating another         |

For a native owner bump, the executor uses the existing listing's bump control
and records acceptance, rejection or an explicit site cooldown. It does not need
an independent historical eligibility proof before attempting the selected bump.
Preview inspects that path and stops before the effect; it cannot prove acceptance.
Reddit uses `old.reddit.com`. The caller supplies appropriate approved content,
including substantive news when selecting a forum news action.

The runner retains ownership locks and checks publishing configuration, pauses,
stored deadlines, the manifest's minimum interval and its persisted 15–30 minute
buffer before starting an executor. It rechecks the saved schedule before
forwarding a browser mutation and checkpoints possible effects.
An interrupted or ambiguous effect remains uncertain and blocks another run.
A completed inspection involving form interactions but no visibility action is
recorded as `no-action`, which does not count as a post. The LLM chooses browser
interactions to accomplish the assignment; the runner does not encode website
flows. The caller remains responsible for account/community-wide policy and
cadence; the dispatcher's saved target deadline is not a complete policy engine.

The final structured result contains the execution outcome, evidence, prepared
copy and any receipt. The executor supplies `nextEligibleAt` only when the site
actually supplies a deadline; the runner computes normal scheduling after a
successful receipt. The runner reads back a claimed receipt and
captures its screenshot; a verified receipt needs new remote confirmation.
Receipt readback independently refreshes the last successfully inspected region
on the same URL, allowing bounded captures on large pages. Quote and freshness
checks decode native node text and retain support for older plain-text baselines.
Non-bump confirmation must match content actually entered during this run.
Reddit additionally requires a fresh visible post permalink and original
publication timestamp. A failed or filtered post still counts conservatively.
The saved outcome carries context into the next run. Browser diagnostics retain
endpoint/action/ref/error metadata without credential values.
Agents return evidence as `{ observationId, ref }` selections from successful
snapshots. The parent resolves immutable captured nodes to their exact URL and
text; foreign observations, empty nodes and model-authored quotes are rejected.
Draft receipts contain only `{status, observationId, ref}`. The parent derives
the URL and receipt quote from that captured node, then
independently rereads the live page before settlement. Persistent confirmation
text avoids transient toasts and adjacent countdown nodes changing during readback.
The parent also binds receipt occurrence IDs: a real run uses its claimed ID;
read-only reconciliation requires exactly one uncertain attempt for the assigned
target and settles that original ID with `performedAction: false`.
Browser `control-state` reports rendered/enabled and viewport state. Hidden or
disabled click targets fail before dispatch without poisoning the publishing
guard. Unknown post-dispatch errors retain the uncertainty lock.
Inspection errors before dispatch are also explicitly safe to recover from;
viewport state is null when the native endpoint does not report it.
Snapshots retain native hierarchy depth and element tags so the executor can
select an enclosing visible element when text-node inspection fails.
Navigation checkpoints retain each newly visited page's pre-mutation baseline, while an
existing page's original baseline remains immutable.

DISBOARD checks effective Manage Messages permission before invoking `/bump`.
This includes the server's moderation 2FA requirement and the outreach account's
MFA state; a role permission alone is insufficient on servers requiring 2FA.
To retry only cleanup of a saved verified confirmation, use
`local.ts cleanup disboard-native-bump --occurrence <original-occurrence-id>`
with the isolated outreach daemon running. This records a separate cleanup
result without inference, another bump, or a change to the original cooldown.
Known Discord receipt messages are fetched directly by ID for fresh readback,
so later channel activity does not hide an older confirmation.
Discord status/read operations supply equivalent references. Stored results
retain the URL/quote format. Failed runs retain the rejected draft, captured
observations and redacted tool trace under private `diagnostics/` keys, including
local preview artifacts. Historical notes cannot stand in for captured evidence.
Local previews also retain redacted frozen observations for structured blocked
results, so an authentication error can be inspected beyond its generic heading.

Preview blocks promotion clicks, form edits, Enter submissions, action URLs and
receipt settlement outside the prompt. Budgeted CAPTCHA solving is available;
the local suite shares one solver budget and reports reservations, actual costs
and unsettled charges. A staged response token need not change the visible
checkbox; site acceptance remains unverified until an authorized submission.
Ordinary form callbacks never run automatically. Captured Cloudflare
interstitial callbacks may complete security navigation. Managed challenges that
the native Cloudflare solver cannot clear still require complete captured
parameters for the paid solver. Capturing them before render requires a browser
page-init capability; current-document evaluation alone does not guarantee that
paid managed-challenge path.
Preview permits
navigation, screenshots, scrolling, native read-only search inputs and one
stored-credential sign-in. Message composers remain blocked.
Preview also permits observed tabs and menu disclosures using their native
accessibility metadata while blocking submit/reset and effect controls.
Browser requests
are serialized within each run, and controls use the refs from its current
snapshot rather than silently taking another snapshot during credential fill.
Reconciliation permits private stored-credential authentication for inspection,
but never creates another promotional effect or buys a CAPTCHA task. These modes use the
same task-driven agent and browser connection as a publishing run.

The `the-storm-promotion-enabled` flag defaults off. Typed
`the-storm-promotion-settings` selects targets, model, step/time limits and solver
allowance; defaults are an empty target list, 80 steps, 15 minutes and $10 monthly
solver spending. Both declared Schedules start paused. An authenticated publishing
canary and its receipt are separate acceptance requirements before activation.

The dispatch schedule selects 08:00, 12:00, 16:00 and 20:00 Pacific sweeps.
Daily and less-frequent sources use 16:00–20:00, with durable Workflow timers
waiting for a stored cooldown within that window. Scheduled actions recheck the
window before mutation. Source cooldowns and four-attempt daily limits remain
additional constraints. Production AI usage uses a shared daily spending stop
(default $5 including recorded solver charges); unknown prior usage stops new
paid work. This is an admission stop, not a provider-side billing guarantee.

Namespace-separated SeaweedFS state holds assessments, run audits, attempts,
evidence and solver reservations. The dedicated 1Password item supplies the
solver key and account-keyed login map; profiles are named
`storm-promotion-<account>`. Browser, solver, storage, site-login and report
credentials stay outside the provider subprocess. The separate promotion worker
uses the shared agent runner. Daily reports and deduplicated actionable alerts
use the existing reports worker and Postal recipient. Production Discord tasks
bootstrap the isolated outreach daemon through the packaged toolkit. They pass
only the outreach login and one current TOTP into that child. Approved variants
are supplied as JSON and checked before dispatch; rate limits reject rather than
queue retries, and a disconnected writer terminates its isolated daemon.
Publishing still requires the production flag and a target allowlist; these
source capabilities do not establish production deployment or live acceptance.

## Documentation

- [Temporal overview](../docs/wiki/src/content/docs/explanation/temporal/overview.md)
  explains the deployment and ownership model.
- [Workflow families](../docs/wiki/src/content/docs/explanation/temporal/workflow-families.md)
  explains domain boundaries.
- [Schedule reference](../docs/wiki/src/content/docs/reference/temporal-schedules.md)
  lists registered schedules and their policy.
- [Workflow reference](../docs/wiki/src/content/docs/reference/temporal-workflows.md)
  lists durable workflow interfaces.
- [Worker rollout how-to](../docs/wiki/src/content/docs/how-to/roll-out-a-temporal-worker-deployment.md)
  is the operator procedure.
- [Agent task boundary](../docs/wiki/src/content/docs/explanation/temporal/agent-task-boundary.md)
  and [input reference](../docs/wiki/src/content/docs/reference/agent-task-input.md)
  define generic agent tasks.

Source remains authoritative: schedule definitions live in
`src/schedules/schedule-definitions.ts`, role registries live beside worker
startup, and command schemas live in `scripts/`. [AGENTS.md](AGENTS.md) contains
only the constraints that every package task must keep in context.
