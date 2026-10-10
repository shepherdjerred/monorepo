# @shepherdjerred/temporal

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
the tool manifest and Dockerfiles. Ready generated PRs freeze their stream.

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

Production runs one image in twelve single-replica Kubernetes Deployments. The
`control` role owns schedule reconciliation and public HTTP/event surfaces
plus the `agent-chat-ingress` command queue and isolated
`agent-chat-delivery` queue. The credentialless
`workflows` role owns deterministic Workflow execution on
`monorepo-workflows`. The domain roles own only Activity
Workers, with separate registries, credentials, service accounts, and
concurrency budgets. The explicit `all` role composes every role in one process
for local development.

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
in `beta` to drain retained executions. All other central queues are `prod`
only. Schedule registration retires the old beta schedule without cancelling
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
| `workflows`       | `monorepo-workflows`                                                                   |                               none |

The production manifests land in layers. The gateway, Workflow worker, and
domain Activity Workers deploy independently so each queue has its own
credentials, concurrency, health, and metrics boundary.

The infra process polls `ops` separately so every-five-minute snapshot fan-out
can overlap four bounded reads while heavyweight infra automation stays serial.
Ops queue routing is recorded with the `ops-isolated-activity-queue` Workflow
patch. Histories created before that patch retain their `infra` Activity queue;
the infra registry keeps the old Ops Activities available to drain them. The
same worker credentials, pod limits, and metrics endpoint serve both queues.

Woodpecker log retention uses the serial infra queue and a daily 04:45 Pacific
Schedule with SKIP overlap, initially paused. The typed minimum retention is
30 days and destructive execution defaults off. Exact candidates, protections,
continuation cursors and deletion receipts remain in Workflow results; logs
alone are deleted. See the [operator procedure](../docs/wiki/src/content/docs/how-to/retain-woodpecker-logs.md)
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
TEMPORAL_NAMESPACE=prod bun run worker-deployment inspect --build-id <image-git-sha>
TEMPORAL_NAMESPACE=prod bun run worker-deployment status --build-id <image-git-sha>
TEMPORAL_NAMESPACE=beta bun run worker-deployment status --target scout-beta --build-id <image-git-sha>
```

Worker Deployment rollouts use the package-local `worker-deployment` command;
no toolkit wrapper is added. `start` runs the real workflow replay suite,
replays retained IDs listed in `TEMPORAL_REPLAY_WORKFLOW_IDS` against the
candidate bundle, and runs an exact-version canary before opening a 10% ramp.
Set `TEMPORAL_ADDRESS` to an
operator-reachable endpoint; native calls use the existing `toolkit temporal`
passthrough. Toolkit resolves the external API token through its credential
broker and passes it only through the Temporal process environment. In-cluster
calls to the namespace-local frontend skip that credential lookup. The first ramp also requires
`--stable-build-id <sha>` so an empty
deployment has a rollback target. `advance` checks candidate and stable poller
history, Prometheus rule-evaluation health, and candidate Build ID Workflow
failure counters across each ramp window. Alerts from other workers remain
visible in monitoring but do not block routing.
`promote` checks the two-hour health history, verifies the candidate pin's baked
`GIT_SHA`, and writes the stable pin before changing routing so an interrupted
command is safe to retry. `rollback` removes the exact active ramp,
even if a newer build registered. CI retains a Workflow candidate whenever its
pin differs from stable, so a later image release cannot evict an in-flight
ramp. After rollback and candidate-history drain, rerun `rollback` with no
active ramp to reset the rejected candidate to the stable catalog value, then
review and commit both the catalog and `scripts/pin-candidates-state.json`
changes through the normal pull-request flow before the next candidate.
The reset records the rejected release number in `withdrawnCandidates`.
Published handoffs and pending pin branches cannot restore that candidate or an
older one; a newer candidate can still be retained while its commit-back waits.
If an operator host dies, use `inspect` before removing a stale lease: it is a
read-only routing and lease query that remains usable when candidate health
checks or alert windows are failing.
The target defaults to `central`; `--target scout-beta` and `--target
scout-prod` select the stage-local Scout deployment, queue, replay bundle,
pinned canary, image repository, and catalog pins.

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
Scout extraction uses two capable image releases. The pre-entrypoint pin creates
no pod. Copy the first capable candidate pin to stable; that creates only the
credentialless stable poller. A later distinct candidate pin creates the ramp
target, and `start --stable-build-id` establishes stable before sending 10% to
candidate. The embedded poller remains only to drain old unversioned histories.
Production remains embedded until beta acceptance completes.

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

The reports worker resolves `temporal-email-recipient` and
`temporal-email-sender` through typed configuration for each delivery activity.
Defaults preserve the existing homelab routing during a flag-provider outage.
Postal credentials stay in 1Password; service endpoints and host routing are
reviewed homelab bootstrap settings. Workflow histories contain no credentials.

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
