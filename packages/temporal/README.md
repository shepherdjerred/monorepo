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

A compound recipe, such as TSMC's companion and server, runs its sub-recipes'
steps in recipe order under one deployment and one lease. Each step key is
prefixed with its sub-recipe's position (`sub2-step-sync`). A model
`minecraft-upgrade` step has two release modes:

- `verified-restore` runs before the sync, through the v1 preservation
  controller. While players defer preservation, the step waits. The sync then
  requires the fresh preservation proof.
- `retained-volume-restart` runs after the sync. It reads back that the server
  runs exactly `repository:version@digest`.

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
schema errors fail immediately. Minecraft preservation and recovery
HTTP requests disable socket idle timeouts during backups while retaining their
two-hour total deadline and caller cancellation.

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

An admin control-plane intent freezes the controller chart and original Temporal
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
one exists. Broker only the registered root Argo credential through the existing
service-account wrapper, and strip vault access from the child:

```bash
ARGOCD_TOKEN=op://v64ocnykdqju4ui6j6pua56xw4/ga3ma76q6vw2bxeyvkqj4xaucy/ARGOCD_TOKEN scripts/onepassword/with-service-account.sh op run -- env -u OP_SERVICE_ACCOUNT_TOKEN bun packages/homelab/scripts/argocd/argocd.ts sync-managed delivery --revision ALREADY_SELECTED_REVISION --request-id RECORDED_OR_NEW_REQUEST_UUID
```

Use the same command with `delivery-control-plane` only after catalog integrity
is established. It restores the already selected native resources; it neither
changes PostgreSQL selection nor releases a lock. The root release and guarded
sync commands remain independent infrastructure recovery tools after CI stops
deploying workloads.

For damaged or missing data, first restore and verify an independent copy with
the [independent restore procedure](../docs/wiki/src/content/docs/how-to/upgrade-a-homelab-postgresql-major-version.md#2-verify-an-independent-offsite-restore)
in the PostgreSQL operator how-to. It holds the Restore template, the tokenless
local-socket-only verification Pod and Delivery's integrity checks. The
protected source is `delivery/pgdata-delivery-postgresql-0`; the inert,
restricted destination is `delivery-catalog-recovery/pgdata-delivery-postgresql-0`.
Restore only the reviewed PV/PVC backup and its complete snapshot chain into
that destination, never application controllers, Secrets or service accounts.
The destination has no application writer and is excluded from new backups.
Its deny-all NetworkPolicy is not enforced by the current Flannel CNI, so the
how-to keeps the verification Pod offline by configuration and requires proof
that it holds no socket.

Require completed snapshots, distinct PV/CSI handles, matching server major
version, successful crash recovery/checksums and catalog/audit/lock/outbox
integrity. Restore the verified catalog with all API writers stopped using the
existing PostgreSQL recovery procedure, preserving the original volume. Then
reconcile the API at its captured source and inspect actual Temporal, native Job
and Argo identities against restored records before resuming submissions. A
stale backup cannot justify accepting releases or clearing quarantine. This
source procedure has not been exercised by disrupting healthy production.

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
follow the plan the worker preflight recorded. Any other stage, or an unsettled
step of another sub-recipe, fails closed.
`scripts/rollout/worker-delivery-recovery.ts` runs the same verifier through
brokered operator credentials when Activity workers are unavailable; it never
resumes effects or accepts the failed release.

TSMC's explicit `retained-volume-restart` pipeline mode skips the preservation
Activity and uses normal owned Argo reconciliation and exact Ready image checks
against the retained world PVC. Scheduled backups remain independent. The
`verified-restore` mode and older pipelines without a mode keep the full
preservation path; existing Workflow histories keep their recorded branch.

TSMC preservation records an original-source snapshot in the controller's private
durable journal before returning its native Pod receipt. A failed pre-selection
deployment can request a separate admin Minecraft recovery intent, including
after preservation completed or the receipt callback was lost. Recovery may
reopen the untouched original and clean the exact validation copy. The API then
independently reads the journal report and Argo source, checks native volume,
Pod and route identities, and releases only the same quarantined generation.
Missing original evidence or an admitted `reconcile` stage blocks this path.
The dedicated controller receives the existing Argo credential solely for its
original-abort managed-resource read. Its closed Python child environment passes
that credential without inheriting executor or vault credentials.
Verification failures report only a fixed source/restored phase, exception class,
producer exit and classified stream error. Raw child stderr stays bounded in
memory; world paths, contents and hashes never enter the failed Activity message.

`scripts/rollout/minecraft-delivery-recovery.ts` invokes that same controller and
independent API verification during a Workflow-worker outage. First inspect the
intent with `toolkit deploy minecraft recovery <INTENT_ID> --json`, then keep an
explicit `kubectl --context admin@torvalds -n delivery-tsmc-controller
port-forward pod/delivery-tsmc-controller-0 17356:7356 --address 127.0.0.1` in a
separate terminal. Run `bun scripts/rollout/minecraft-delivery-recovery.ts --intent
<INTENT_ID> --url <DELIVERY_URL> --controller-url http://127.0.0.1:17356` from this
package. The command brokers only the registered executor credential, requires a
loopback transport, and reports structured settlement without changing the failed
deployment result. Stop that exact port-forward after readback.

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

The Bryan Bucks analytics schedule runs in `prod`, where the central Workflow
executor polls `monorepo-workflows`; its `scout` Activity calls the beta Scout
data endpoint. The central Scout worker also polls the unchanged `scout` queue
in `beta` to drain retained executions. The central Workflow and reports
workers also poll `beta` for the explicit notification acceptance canary.
Other central Activity queues are `prod` only. Schedule registration retires the old beta schedule without cancelling
existing executions.

| Role              | Queue or surface                                                                       |               Activity concurrency |
| ----------------- | -------------------------------------------------------------------------------------- | ---------------------------------: |
| `control`         | schedules, HTTP APIs, `agent-chat-ingress`, `agent-chat-delivery`, `agent-chat-photon` |                        4 per queue |
| `home`            | `home`                                                                                 |                                  4 |
| `reports`         | `reports`                                                                              |                                  4 |
| `infra`           | `infra`, `mining-reset`; bounded Ops collection on `ops`                               | 1 on each legacy queue; 4 on `ops` |
| `repo`            | `repo-automation`, `agent-chat-dispatch`, `agent-chat-receipts`                        |                        1 per queue |
| `scout`           | `scout`                                                                                |                                  1 |
| `agent`           | `agent-task`                                                                           |                                  1 |
| `glitter-corpus`  | `glitter-corpus`                                                                       |                                  1 |
| `glitter-context` | `glitter-context`                                                                      |                                  1 |
| `maintenance`     | `maintenance`                                                                          |                                  1 |
| `media-network`   | `media-network`                                                                        |                                  4 |
| `media-files`     | `media-files`                                                                          |                                  1 |
| `workflows`       | `monorepo-workflows`                                                                   |                               none |
| `streambot`       | `streambot`                                                                            |                                  1 |

The `streambot-lol-playback` Schedule reconciles explicitly selected LoL series
through the isolated `streambot` Activity queue. The worker receives only its
internal Streambot endpoint and dedicated scheduler credential. Streambot owns
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

Plex event hints use the existing durable outbox to start
`observePlexEventHintWorkflow` on `monorepo-workflows`; its only observation
Activity runs on `media-network`. History contains bounded media/mapping IDs,
never the webhook capability, raw payload, account or poster. The default-off
hint gate does not replace polling or final retention checks. A hint requests a
fresh scoped watch read; it grants no deletion authority.

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

The infra worker persists each successful R2 orphan observation in the
`temporal/velero-r2-orphan-audit-state` ConfigMap before publishing
its gauges. Startup restores the original observation time and values; other
roles publish no initialized zero inventory. Conditional writes prevent an
older concurrent scan from replacing a newer observation. The R2 audit
credential remains read-only. Missing state or an observation older than
36 hours is unknown and raises the audit freshness alert.

The reports worker resolves `temporal-email-recipient` and
`temporal-email-sender` through typed configuration for each delivery activity.
Defaults preserve the existing homelab routing during a flag-provider outage.
Postal credentials stay in 1Password; service endpoints and host routing are
reviewed homelab bootstrap settings. Workflow histories contain no credentials.

`temporal-daily-report-notifications-enabled` resolves per Activity and defaults
off in production, with beta targeting declared for acceptance. When enabled,
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
